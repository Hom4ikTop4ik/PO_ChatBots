
import asyncio
import json
import logging
import uuid
from copy import deepcopy
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from psycopg2.extras import Json

from .auth_utils import parse_session_token_safe
from .db import get_connection

log = logging.getLogger("collaboration")

LOCK_TTL_SECONDS = 30
DISCONNECT_GRACE_SECONDS = 10
SNAPSHOT_THRESHOLD = 500
PARTICIPANT_COLORS = [
    "#E91E63", "#9C27B0", "#3F51B5", "#03A9F4",
    "#009688", "#4CAF50", "#FFC107", "#FF5722",
    "#795548", "#607D8B",
]


def color_for_user(user_id: int) -> str:
    return PARTICIPANT_COLORS[user_id % len(PARTICIPANT_COLORS)]

class Participant:
    def __init__(self, user_id: int, display_name: str, email: str = ""):
        self.user_id = user_id
        self.display_name = display_name
        self.email = email
        self.color = color_for_user(user_id)
        self.status = "active"  # active | disconnected

    def to_dict(self) -> Dict[str, Any]:
        return {
            "user_id": self.user_id,
            "display_name": self.display_name,
            "email": self.email,
            "color": self.color,
            "status": self.status,
        }


class PresenceState:
    def __init__(self, user_id: int):
        self.user_id = user_id
        self.cursor: Optional[Dict[str, float]] = None
        self.selected_block_id: Optional[str] = None
        self.dangling_edge: Optional[Dict[str, Any]] = None
        self.dragging_block: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "user_id": self.user_id,
            "cursor": self.cursor,
            "selected_block_id": self.selected_block_id,
            "dangling_edge": self.dangling_edge,
            "dragging_block": self.dragging_block,
        }


class FieldLock:
    def __init__(self, block_id: str, field_name: str, locked_by: int):
        self.block_id = block_id
        self.field_name = field_name
        self.locked_by = locked_by
        self.acquired_at = datetime.utcnow()

    @property
    def expired(self) -> bool:
        return datetime.utcnow() - self.acquired_at > timedelta(seconds=LOCK_TTL_SECONDS)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "block_id": self.block_id,
            "field_name": self.field_name,
            "locked_by": self.locked_by,
            "acquired_at": self.acquired_at.isoformat(),
        }


class EditSession:
    def __init__(self, scenario_id: str, version: int, state: Dict[str, Any]):
        self.scenario_id = scenario_id
        self.version = version
        self.state = state
        self.participants: Dict[int, Participant] = {}
        self.connections: Dict[int, WebSocket] = {}
        self.presence: Dict[int, PresenceState] = {}
        self.op_buffer: List[Dict[str, Any]] = []
        self.locks: Dict[Tuple[str, str], FieldLock] = {}
        self.disconnect_timers: Dict[int, asyncio.Task] = {}
        self.pending_replace: Optional[Dict[str, Any]] = None
        self.replace_timer: Optional[asyncio.Task] = None
        self.lock = asyncio.Lock()

    def participants_payload(self) -> List[Dict[str, Any]]:
        return [p.to_dict() for p in self.participants.values()]


def apply_op_to_state(state: Dict[str, Any], op: Dict[str, Any]) -> Dict[str, Any]:
    nodes = list(state.get("nodes", []))
    edges = list(state.get("edges", []))
    op_type = op["type"]
    data = op.get("data", {})

    if op_type == "BLOCK_ADD":
        node = data["node"]
        if not any(n["id"] == node["id"] for n in nodes):
            nodes = nodes + [deepcopy(node)]

    elif op_type == "BLOCK_DELETE":
        block_id = data["block_id"]
        nodes = [n for n in nodes if n["id"] != block_id]
        edges = [e for e in edges
                 if e.get("source") != block_id and e.get("target") != block_id]

    elif op_type == "BLOCK_MOVE":
        block_id = data["block_id"]
        new_pos = data.get("new_position") or {}
        if "x" in new_pos and "y" in new_pos:
            nodes = [
                {**n, "position": {"x": new_pos["x"], "y": new_pos["y"]}}
                if n["id"] == block_id else n
                for n in nodes
            ]

    elif op_type == "BLOCK_UPDATE":
        block_id = data["block_id"]
        patch = data.get("patch", {})
        nodes = [
            {**n, "data": {**n.get("data", {}), **patch}}
            if n["id"] == block_id else n
            for n in nodes
        ]

    elif op_type == "EDGE_ADD":
        edge = data["edge"]
        if not any(e["id"] == edge["id"] for e in edges):
            edges = edges + [deepcopy(edge)]

    elif op_type == "EDGE_DELETE":
        edge_id = data["edge_id"]
        edges = [e for e in edges if e["id"] != edge_id]

    elif op_type == "EDGE_UPDATE":
        edge_id = data["edge_id"]
        patch = data.get("patch", {})
        edges = [{**e, **patch} if e["id"] == edge_id else e for e in edges]

    elif op_type == "SCENARIO_REPLACE":
        nodes = list(data.get("nodes", []))
        edges = list(data.get("edges", []))

    return {"nodes": nodes, "edges": edges}

def _target_id(op: Dict[str, Any]) -> Optional[str]:
    data = op.get("data", {})
    return (
        data.get("block_id")
        or data.get("edge_id")
        or (data.get("node") or {}).get("id")
        or (data.get("edge") or {}).get("id")
    )


def transform(op_a: Dict[str, Any], op_b: Dict[str, Any]) -> Optional[Dict[str, Any]]:

    if op_b["type"] == "SCENARIO_REPLACE":
        return None

    a_target = _target_id(op_a)
    b_target = _target_id(op_b)

    if a_target != b_target:
        if (op_b["type"] == "BLOCK_DELETE" and op_a["type"] == "EDGE_ADD"):
            edge = op_a["data"]["edge"]
            if op_b["data"]["block_id"] in (edge.get("source"), edge.get("target")):
                return None
        return op_a

    if op_a["type"] == "BLOCK_MOVE" and op_b["type"] == "BLOCK_MOVE":
        return op_a

    if op_b["type"] == "BLOCK_DELETE" and op_a["type"] in ("BLOCK_UPDATE", "BLOCK_MOVE"):
        return None

    if op_b["type"] == "BLOCK_DELETE" and op_a["type"] == "BLOCK_DELETE":
        return None

    if op_a["type"] == "BLOCK_UPDATE" and op_b["type"] == "BLOCK_UPDATE":
        a_fields = set((op_a.get("data", {}).get("patch") or {}).keys())
        b_fields = set((op_b.get("data", {}).get("patch") or {}).keys())
        if a_fields.isdisjoint(b_fields):
            return op_a
        return op_a

    if op_b["type"] == "EDGE_DELETE" and op_a["type"] in ("EDGE_UPDATE", "EDGE_DELETE"):
        return None

    return op_a

def _load_bot_record(scenario_id: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, user_id, name, scenario, version FROM bot_model WHERE id = %s",
                (scenario_id,),
            )
            row = cur.fetchone()
    finally:
        conn.close()
    return row


def _load_user_email(user_id: int) -> str:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT email FROM app_user WHERE id = %s", (user_id,))
            row = cur.fetchone()
    finally:
        conn.close()
    return row["email"] if row else f"user{user_id}"


def _scenario_to_state(scenario_json: Dict[str, Any]) -> Dict[str, Any]:
    blocks = scenario_json.get("Blocks") or []
    type_map = {"sendMessage": "message", "getMessage": "input"}
    nodes = []
    edges = []
    for b in blocks:
        node_type = type_map.get(b.get("Type"), b.get("Type"))
        params = b.get("Params") or {}
        data: Dict[str, Any] = {"label": b.get("BlockName", ""), "kind": node_type}
        if node_type == "message":
            data["text"] = params.get("message", "")
        elif node_type == "input":
            data["prompt"] = params.get("message", "")
            data["variableName"] = params.get("var", "")
            data["variableType"] = params.get("type", "string")
        elif node_type == "condition":
            data["expression"] = params.get("expression", "")
        elif node_type == "choice":
            data["resultVariable"] = params.get("var", "")
            data["prompt"] = params.get("prompt", "")
            data["options"] = params.get("options", [])
        elif node_type == "api":
            data["url"] = params.get("url", "")
            data["method"] = params.get("method", "GET")
            data["headers"] = params.get("headers", {})
            data["body"] = params.get("body", "")
            data["variables"] = params.get("variables", {})
            data["retryCount"] = params.get("retryCount", 0)
        nodes.append({
            "id": b["Block_id"],
            "type": node_type,
            "position": {"x": b.get("X", 0), "y": b.get("Y", 0)},
            "data": data,
        })
        from_id = b["Block_id"]
        out_edges = (b.get("Connections") or {}).get("OutEdges")
        if out_edges:
            for e in out_edges:
                handle_suffix = f"-{e['sourceHandle']}" if e.get("sourceHandle") else ""
                edge: Dict[str, Any] = {
                    "id": e.get("id") or f"{from_id}{handle_suffix}-{e['target']}",
                    "source": from_id,
                    "target": e["target"],
                }
                if e.get("sourceHandle") is not None:
                    edge["sourceHandle"] = e["sourceHandle"]
                if e.get("targetHandle") is not None:
                    edge["targetHandle"] = e["targetHandle"]
                edges.append(edge)
        else:
            for to_id in (b.get("Connections") or {}).get("Out", []):
                edges.append({"id": f"{from_id}-{to_id}", "source": from_id, "target": to_id})
    return {"nodes": nodes, "edges": edges}


def _state_to_scenario(state: Dict[str, Any], base_scenario: Dict[str, Any]) -> Dict[str, Any]:
    nodes = state.get("nodes", [])
    edges = state.get("edges", [])
    in_map: Dict[str, List[str]] = {}
    out_map: Dict[str, List[str]] = {}
    out_edges_map: Dict[str, List[Dict[str, Any]]] = {}
    for e in edges:
        out_map.setdefault(e["source"], []).append(e["target"])
        in_map.setdefault(e["target"], []).append(e["source"])
        out_edge: Dict[str, Any] = {"id": e.get("id", ""), "target": e["target"]}
        if e.get("sourceHandle") is not None:
            out_edge["sourceHandle"] = e["sourceHandle"]
        if e.get("targetHandle") is not None:
            out_edge["targetHandle"] = e["targetHandle"]
        out_edges_map.setdefault(e["source"], []).append(out_edge)

    type_map = {"message": "sendMessage", "input": "getMessage"}
    blocks = []
    for n in nodes:
        node_type = n.get("type")
        scenario_type = type_map.get(node_type, node_type)
        d = n.get("data") or {}
        params: Dict[str, Any] = {}
        if node_type == "message":
            params["message"] = d.get("text", "")
        elif node_type == "input":
            params["message"] = d.get("prompt", "")
            params["var"] = d.get("variableName", "")
            params["type"] = d.get("variableType", "string")
        elif node_type == "condition":
            params["expression"] = d.get("expression", "")
        elif node_type == "choice":
            params["var"] = d.get("resultVariable", "")
            params["prompt"] = d.get("prompt", "")
            params["options"] = d.get("options", [])
        elif node_type == "api":
            params["url"] = d.get("url", "")
            params["method"] = d.get("method", "GET")
            params["headers"] = d.get("headers", {})
            params["body"] = d.get("body", "")
            params["resultVariable"] = d.get("resultVariable", "")
            params["retryCount"] = d.get("retryCount", 0)
        blocks.append({
            "BlockName": d.get("label", ""),
            "Block_id": n["id"],
            "Type": scenario_type,
            "X": int(round((n.get("position") or {}).get("x", 0))),
            "Y": int(round((n.get("position") or {}).get("y", 0))),
            "Params": params,
            "Connections": {
                "In": in_map.get(n["id"], []),
                "Out": out_map.get(n["id"], []),
                "OutEdges": out_edges_map.get(n["id"], []),
            },
        })

    start_node = next((n for n in nodes if n.get("type") == "start"), None)
    final_node = next((n for n in nodes if n.get("type") == "final"), None)
    return {
        "BotName": base_scenario.get("BotName", "Bot"),
        "Token": base_scenario.get("Token", ""),
        "GlobalVariables": base_scenario.get("GlobalVariables", []),
        "Start": start_node["id"] if start_node else "",
        "Final": final_node["id"] if final_node else "",
        "Blocks": blocks,
    }


def _persist_op(scenario_id: str, user_id: int, version: int, op: Dict[str, Any]) -> None:
    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO operation_log (op_id, scenario_id, user_id, version, op_type, op_data)
                    VALUES (%s::uuid, %s::uuid, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (op_id) DO NOTHING
                    """,
                    (op["op_id"], scenario_id, user_id, version, op["type"], Json(op.get("data", {}))),
                )
    finally:
        conn.close()


def _persist_state(scenario_id: str, state: Dict[str, Any], version: int) -> None:
    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT scenario FROM bot_model WHERE id = %s",
                    (scenario_id,),
                )
                row = cur.fetchone()
                base = row["scenario"] if row else {}
                merged = _state_to_scenario(state, base or {})
                cur.execute(
                    """
                    UPDATE bot_model
                    SET scenario = %s::jsonb,
                        version  = %s,
                        updated_at = now()
                    WHERE id = %s
                    """,
                    (Json(merged), version, scenario_id),
                )
    finally:
        conn.close()


def _ensure_edit_session_row(scenario_id: str, version: int) -> None:
    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO edit_sessions (id, scenario_id, version)
                    VALUES (%s::uuid, %s::uuid, %s)
                    ON CONFLICT (scenario_id) DO NOTHING
                    """,
                    (str(uuid.uuid4()), scenario_id, version),
                )
    finally:
        conn.close()


def _load_ops_after(scenario_id: str, after_version: int) -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT op_id, user_id, version, op_type, op_data
                FROM operation_log
                WHERE scenario_id = %s AND version > %s
                ORDER BY version ASC
                """,
                (scenario_id, after_version),
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    return [
        {
            "op_id": str(r["op_id"]),
            "user_id": r["user_id"],
            "type": r["op_type"],
            "applied_version": r["version"],
            "data": r["op_data"],
        }
        for r in rows
    ]
class CollaborationHub:
    def __init__(self):
        self.sessions: Dict[str, EditSession] = {}
        self._global_lock = asyncio.Lock()

    async def get_or_create_session(self, scenario_id: str) -> Optional[EditSession]:
        async with self._global_lock:
            if scenario_id in self.sessions:
                return self.sessions[scenario_id]

            row = _load_bot_record(scenario_id)
            if not row:
                return None
            state = _scenario_to_state(row["scenario"] or {})
            version = int(row["version"] or 0)

            session = EditSession(scenario_id, version, state)
            self.sessions[scenario_id] = session
            _ensure_edit_session_row(scenario_id, version)
            return session

    async def add_participant(self, session: EditSession, user_id: int,
                              websocket: WebSocket) -> Participant:
        async with session.lock:
            t = session.disconnect_timers.pop(user_id, None)
            if t and not t.done():
                t.cancel()

            participant = session.participants.get(user_id)
            if participant is None:
                email = _load_user_email(user_id)
                display_name = email.split("@")[0] if email else f"user{user_id}"
                participant = Participant(user_id, display_name, email)
                session.participants[user_id] = participant
                session.presence[user_id] = PresenceState(user_id)
            else:
                participant.status = "active"

            session.connections[user_id] = websocket

            try:
                conn = get_connection()
                with conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            INSERT INTO session_participants (session_id, user_id, status)
                            SELECT id, %s, 'active' FROM edit_sessions WHERE scenario_id = %s::uuid
                            ON CONFLICT (session_id, user_id) DO UPDATE SET status='active'
                            """,
                            (user_id, session.scenario_id),
                        )
                conn.close()
            except Exception:
                log.exception("session_participants update failed")

            return participant

    async def remove_participant_after_grace(self, session: EditSession, user_id: int) -> None:
        try:
            await asyncio.sleep(DISCONNECT_GRACE_SECONDS)
        except asyncio.CancelledError:
            return
        async with session.lock:
            if user_id in session.connections:
                return
            session.participants.pop(user_id, None)
            session.presence.pop(user_id, None)
            keys_to_drop = [k for k, fl in session.locks.items() if fl.locked_by == user_id]
            for k in keys_to_drop:
                session.locks.pop(k, None)
            await self._broadcast(session, {
                "type": "presence_update",
                "participants": session.participants_payload(),
                "locks": [fl.to_dict() for fl in session.locks.values()],
            })

    async def handle_op(self, session: EditSession, user_id: int,
                        msg: Dict[str, Any]) -> Tuple[str, Optional[Dict[str, Any]], int]:
        op = {
            "op_id": msg["op_id"],
            "type": msg["op_type"],
            "user_id": user_id,
            "base_version": int(msg["base_version"]),
            "timestamp": datetime.utcnow().isoformat(),
            "data": msg.get("data", {}),
        }

        async with session.lock:
            current = session.version
            if op["base_version"] > current:
                return "rejected", "future_base_version", current

            if op["base_version"] < current:
                missed = [m for m in session.op_buffer
                          if m["applied_version"] > op["base_version"]]
                if not missed:
                    missed = _load_ops_after(session.scenario_id, op["base_version"])
                for m in missed:
                    op = transform(op, m)
                    if op is None:
                        return "noop", "transformed_to_noop", current

            new_state = apply_op_to_state(session.state, op)
            session.state = new_state
            new_version = current + 1
            session.version = new_version

            persisted = {**op, "applied_version": new_version}
            session.op_buffer.append(persisted)
            if len(session.op_buffer) > 1000:
                session.op_buffer = session.op_buffer[-1000:]

            try:
                _persist_op(session.scenario_id, user_id, new_version, op)
                _persist_state(session.scenario_id, new_state, new_version)
            except Exception:
                log.exception("persist failed")

            return "accepted", persisted, new_version

    async def acquire_lock(self, session: EditSession, user_id: int,
                           block_id: str, field_name: str) -> Tuple[bool, Optional[FieldLock]]:
        async with session.lock:
            key = (block_id, field_name)
            existing = session.locks.get(key)
            if existing and not existing.expired and existing.locked_by != user_id:
                return False, existing
            fl = FieldLock(block_id, field_name, user_id)
            session.locks[key] = fl
            return True, fl

    async def release_lock(self, session: EditSession, user_id: int,
                           block_id: str, field_name: str) -> None:
        async with session.lock:
            key = (block_id, field_name)
            fl = session.locks.get(key)
            if fl and fl.locked_by == user_id:
                session.locks.pop(key, None)

    async def cleanup_expired_locks(self, session: EditSession) -> List[FieldLock]:
        async with session.lock:
            removed = []
            for k, fl in list(session.locks.items()):
                if fl.expired:
                    removed.append(fl)
                    session.locks.pop(k, None)
            return removed

    async def request_replace(self, session: EditSession, user_id: int,
                              proposed_state: Dict[str, Any]) -> str:
        bot = _load_bot_record(session.scenario_id)
        owner_id = bot["user_id"] if bot else None
        if owner_id and owner_id != user_id and owner_id not in session.connections:
            return "owner_absent"

        async with session.lock:
            others = [uid for uid, p in session.participants.items()
                      if uid != user_id and p.status == "active" and uid in session.connections]
            if session.pending_replace:
                return "busy"
            if not others:
                return "direct"
            requester = session.participants.get(user_id)
            requester_name = requester.display_name if requester else f"user{user_id}"
            session.pending_replace = {
                "requester_id": user_id,
                "state": proposed_state,
                "votes": {},
                "required": set(others),
                "requester_name": requester_name,
            }
            if session.replace_timer:
                session.replace_timer.cancel()
            session.replace_timer = asyncio.create_task(
                self._replace_timeout(session, user_id)
            )
        for uid in others:
            ws = session.connections.get(uid)
            if ws:
                try:
                    await ws.send_json({
                        "type": "replace_vote_request",
                        "requester_id": user_id,
                        "requester_name": requester_name,
                    })
                except Exception:
                    pass
        ws = session.connections.get(user_id)
        if ws:
            try:
                await ws.send_json({"type": "replace_pending", "waiting_for": len(others)})
            except Exception:
                pass
        return "pending"

    async def _replace_timeout(self, session: EditSession, requester_id: int) -> None:
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            return
        async with session.lock:
            if not session.pending_replace or session.pending_replace.get("requester_id") != requester_id:
                return
            session.pending_replace = None
        ws = session.connections.get(requester_id)
        if ws:
            try:
                await ws.send_json({"type": "replace_rejected", "reason": "timeout"})
            except Exception:
                pass
        await self._broadcast(session, {"type": "replace_cancelled"}, exclude_user=requester_id)

    async def vote_replace(self, session: EditSession, user_id: int, approved: bool) -> None:
        apply_args = None
        reject_args = None
        async with session.lock:
            if not session.pending_replace:
                return
            pending = session.pending_replace
            if user_id not in pending["required"]:
                return
            pending["votes"][user_id] = approved
            if not approved:
                requester_id = pending["requester_id"]
                rejector = session.participants.get(user_id)
                rejector_name = rejector.display_name if rejector else f"user{user_id}"
                session.pending_replace = None
                if session.replace_timer:
                    session.replace_timer.cancel()
                reject_args = (requester_id, rejector_name)
            elif all(pending["votes"].get(uid, False) for uid in pending["required"]):
                apply_args = (pending["requester_id"], pending["state"])
                session.pending_replace = None
                if session.replace_timer:
                    session.replace_timer.cancel()

        if reject_args:
            requester_id, rejector_name = reject_args
            ws = session.connections.get(requester_id)
            if ws:
                try:
                    await ws.send_json({"type": "replace_rejected", "reason": "rejected", "by": rejector_name})
                except Exception:
                    pass
            await self._broadcast(session, {"type": "replace_cancelled"}, exclude_user=requester_id)

        elif apply_args:
            requester_id, proposed_state = apply_args
            msg = {
                "op_id": str(uuid.uuid4()),
                "op_type": "SCENARIO_REPLACE",
                "base_version": session.version,
                "data": proposed_state,
            }
            result, persisted, new_version = await self.handle_op(session, requester_id, msg)
            if result == "accepted":
                await self._broadcast(session, {
                    "type": "replace_applied",
                    "op": persisted,
                    "applied_version": new_version,
                })

    async def _broadcast(self, session: EditSession, message: Dict[str, Any],
                         exclude_user: Optional[int] = None) -> None:
        dead: List[int] = []
        for uid, ws in list(session.connections.items()):
            if uid == exclude_user:
                continue
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(uid)
        for uid in dead:
            session.connections.pop(uid, None)


HUB = CollaborationHub()


router = APIRouter()


@router.websocket("/ws/collab/{scenario_id}")
async def collab_websocket(websocket: WebSocket, scenario_id: str):
    token = websocket.cookies.get("session")
    user_id = parse_session_token_safe(token)
    if not user_id:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    session = await HUB.get_or_create_session(scenario_id)
    if session is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION,
                              reason="scenario_not_found")
        return

    await websocket.accept()
    participant = await HUB.add_participant(session, user_id, websocket)

    try:
        await websocket.send_json({
            "type": "snapshot",
            "scenario_id": scenario_id,
            "version": session.version,
            "state": session.state,
            "you": participant.to_dict(),
            "participants": session.participants_payload(),
            "locks": [fl.to_dict() for fl in session.locks.values()],
        })
        await HUB._broadcast(session, {
            "type": "presence_update",
            "participants": session.participants_payload(),
            "locks": [fl.to_dict() for fl in session.locks.values()],
        }, exclude_user=user_id)
    except (WebSocketDisconnect, Exception):
        session.connections.pop(user_id, None)
        timer = asyncio.create_task(HUB.remove_participant_after_grace(session, user_id))
        session.disconnect_timers[user_id] = timer
        return

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            await _dispatch_client_message(session, user_id, msg)
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("websocket error")
    finally:
        session.connections.pop(user_id, None)
        async with session.lock:
            p = session.participants.get(user_id)
            if p:
                p.status = "disconnected"
            keys_to_drop = [k for k, fl in session.locks.items() if fl.locked_by == user_id]
            for k in keys_to_drop:
                session.locks.pop(k, None)
        timer = asyncio.create_task(HUB.remove_participant_after_grace(session, user_id))
        session.disconnect_timers[user_id] = timer
        await HUB._broadcast(session, {
            "type": "presence_update",
            "participants": session.participants_payload(),
            "locks": [fl.to_dict() for fl in session.locks.values()],
        })


async def _dispatch_client_message(session: EditSession, user_id: int,
                                   msg: Dict[str, Any]) -> None:
    mtype = msg.get("type")

    if mtype == "op":
        result, payload, new_version = await HUB.handle_op(session, user_id, msg)
        ws = session.connections.get(user_id)
        if not ws:
            return

        if result == "accepted":
            await ws.send_json({
                "type": "op_ack",
                "op_id": msg["op_id"],
                "applied_version": new_version,
            })
            await HUB._broadcast(session, {
                "type": "op_broadcast",
                "op": payload,
                "applied_version": new_version,
            }, exclude_user=user_id)
        else:
            await ws.send_json({
                "type": "op_reject",
                "op_id": msg["op_id"],
                "reason": payload or "rejected",
                "current_version": new_version,
            })

    elif mtype == "presence":
        ps = session.presence.setdefault(user_id, PresenceState(user_id))
        if "cursor" in msg:
            ps.cursor = msg["cursor"]
        if "selected_block_id" in msg:
            ps.selected_block_id = msg["selected_block_id"]
        if "dragging_block" in msg:
            ps.dragging_block = msg["dragging_block"]
        if "dangling_edge" in msg:
            ps.dangling_edge = msg["dangling_edge"]
        await HUB._broadcast(session, {
            "type": "presence_update",
            "presence": [p.to_dict() for p in session.presence.values()],
            "participants": session.participants_payload(),
            "locks": [fl.to_dict() for fl in session.locks.values()],
        }, exclude_user=user_id)

    elif mtype == "lock_acquire":
        block_id = msg["block_id"]
        field_name = msg["field_name"]
        ok, info = await HUB.acquire_lock(session, user_id, block_id, field_name)
        ws = session.connections.get(user_id)
        if not ws:
            return
        if ok:
            await ws.send_json({
                "type": "lock_granted",
                "block_id": block_id,
                "field_name": field_name,
                "locked_by": user_id,
            })
            await HUB._broadcast(session, {
                "type": "lock_broadcast",
                "lock": info.to_dict(),
            }, exclude_user=user_id)
        else:
            await ws.send_json({
                "type": "lock_denied",
                "block_id": block_id,
                "field_name": field_name,
                "locked_by": info.locked_by,
            })

    elif mtype == "lock_release":
        block_id = msg["block_id"]
        field_name = msg["field_name"]
        await HUB.release_lock(session, user_id, block_id, field_name)
        await HUB._broadcast(session, {
            "type": "lock_release_broadcast",
            "block_id": block_id,
            "field_name": field_name,
        })

    elif mtype == "resync":
        client_version = int(msg.get("from_version", 0))
        gap = session.version - client_version
        ws = session.connections.get(user_id)
        if not ws:
            return
        if gap > SNAPSHOT_THRESHOLD:
            await ws.send_json({
                "type": "snapshot",
                "scenario_id": session.scenario_id,
                "version": session.version,
                "state": session.state,
                "participants": session.participants_payload(),
                "locks": [fl.to_dict() for fl in session.locks.values()],
            })
        else:
            ops = _load_ops_after(session.scenario_id, client_version)
            await ws.send_json({"type": "ops_replay", "ops": ops})

    elif mtype == "replace_request":
        proposed_state = msg.get("state", {})
        result = await HUB.request_replace(session, user_id, proposed_state)
        if result == "direct":
            synthetic = {
                "op_id": str(uuid.uuid4()),
                "op_type": "SCENARIO_REPLACE",
                "base_version": session.version,
                "data": proposed_state,
            }
            op_result, persisted, new_version = await HUB.handle_op(session, user_id, synthetic)
            if op_result == "accepted":
                ws = session.connections.get(user_id)
                if ws:
                    try:
                        await ws.send_json({"type": "replace_applied", "op": persisted, "applied_version": new_version})
                    except Exception:
                        pass
                await HUB._broadcast(session, {"type": "replace_applied", "op": persisted, "applied_version": new_version}, exclude_user=user_id)
        elif result in ("busy", "owner_absent"):
            ws = session.connections.get(user_id)
            if ws:
                try:
                    await ws.send_json({"type": "replace_rejected", "reason": result})
                except Exception:
                    pass

    elif mtype == "replace_vote":
        approved = bool(msg.get("approved"))
        await HUB.vote_replace(session, user_id, approved)
