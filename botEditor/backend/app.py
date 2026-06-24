import os
import uuid

from fastapi import Depends, FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi import Request
from passlib.context import CryptContext
from psycopg2.extras import Json
from psycopg2 import Error as PsycopgError

from .auth_utils import (
    JWT_TTL_MINUTES,
    create_session_token,
    parse_session_token,
)
from .db import get_connection
from .collaboration import router as collab_router

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

app = FastAPI(title="Bot Editor Backend")

origins_env = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
origins = [o.strip() for o in origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(collab_router)


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="session",
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=JWT_TTL_MINUTES * 60,
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie("session")


async def current_user(request: Request):
    token = request.cookies.get("session")
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    user_id = parse_session_token(token)
    return {"id": user_id}


@app.post("/api/auth/register")
async def register(payload: dict, response: Response):
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""

    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password are required")

    password_hash = pwd_context.hash(password)

    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM app_user WHERE email = %s", (email,))
                if cur.fetchone():
                    raise HTTPException(status_code=400, detail="User already exists")

                cur.execute(
                    "INSERT INTO app_user (email, password_hash) VALUES (%s, %s) RETURNING id, email",
                    (email, password_hash),
                )
                row = cur.fetchone()
    finally:
        conn.close()

    token = create_session_token(row["id"])
    set_session_cookie(response, token)

    return {"id": row["id"], "email": row["email"]}


@app.post("/api/auth/login")
async def login(payload: dict, response: Response):
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""

    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password are required")

    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, email, password_hash FROM app_user WHERE email = %s",
                    (email,),
                )
                row = cur.fetchone()
    finally:
        conn.close()

    if not row or not pwd_context.verify(password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_session_token(row["id"])
    set_session_cookie(response, token)

    return {"id": row["id"], "email": row["email"]}


@app.get("/api/auth/me")
async def me(user=Depends(current_user)):
    user_id = user["id"]
    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, email, created_at FROM app_user WHERE id = %s",
                    (user_id,),
                )
                row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "id": row["id"],
        "email": row["email"],
        "created_at": row["created_at"].isoformat(),
    }


@app.post("/api/auth/logout")
async def logout(response: Response):
    clear_session_cookie(response)
    return {"ok": True}


def _bot_to_dict(row, *, is_owner=True, session_active=False):
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "scenario": row["scenario"],
        "version": int(row.get("version", 0) or 0),
        "created_at": row["created_at"].isoformat(),
        "updated_at": row["updated_at"].isoformat(),
        "is_owner": bool(row.get("is_owner", is_owner)),
        "session_active": bool(row.get("session_active", session_active)),
        "owner_email": row.get("owner_email") or None,
    }


@app.post("/api/bots")
async def create_bot(payload: dict, user=Depends(current_user)):
    user_id = user["id"]
    name = (payload.get("name") or "").strip() or "Новый бот"
    scenario = payload.get("scenario") or {}

    bot_id = str(uuid.uuid4())

    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                try:
                    cur.execute(
                        """
                        INSERT INTO bot_model (id, user_id, name, scenario, version)
                        VALUES (%s::uuid, %s, %s, %s::jsonb, 0)
                        RETURNING id, name, scenario, version, created_at, updated_at
                        """,
                        (bot_id, user_id, name, Json(scenario)),
                    )
                except PsycopgError as e:
                    raise HTTPException(
                        status_code=400,
                        detail=f"DB error while creating bot: {e.pgerror or str(e)}",
                    )

                row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        raise HTTPException(status_code=500, detail="Failed to create bot")

    return _bot_to_dict(row)


@app.get("/api/bots")
async def get_bots(user=Depends(current_user)):
    user_id = user["id"]

    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT b.id, b.name, b.scenario, b.version, b.created_at, b.updated_at,
                           true AS is_owner,
                           COALESCE(es.shared, false) AS session_active
                    FROM bot_model b
                    LEFT JOIN edit_sessions es ON es.scenario_id = b.id
                    WHERE b.user_id = %s
                    ORDER BY b.created_at DESC
                    """,
                    (user_id,),
                )
                owned = cur.fetchall()
                cur.execute(
                    """
                    SELECT b.id, b.name, b.scenario, b.version, b.created_at, b.updated_at,
                           false AS is_owner,
                           COALESCE(es.shared, false) AS session_active,
                           au.email AS owner_email
                    FROM bot_access ba
                    JOIN bot_model b ON b.id = ba.bot_id
                    LEFT JOIN edit_sessions es ON es.scenario_id = b.id
                    JOIN app_user au ON au.id = b.user_id
                    WHERE ba.user_id = %s
                    ORDER BY ba.joined_at DESC
                    """,
                    (user_id,),
                )
                shared = cur.fetchall()
    finally:
        conn.close()

    return [_bot_to_dict(row) for row in list(owned) + list(shared)]


@app.post("/api/bots/{bot_id}/access")
async def record_bot_access(bot_id: str, user=Depends(current_user)):
    user_id = user["id"]
    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("SELECT user_id FROM bot_model WHERE id = %s::uuid", (bot_id,))
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Bot not found")
                if row["user_id"] == user_id:
                    return {"ok": True}
                cur.execute(
                    """
                    INSERT INTO bot_access (user_id, bot_id)
                    VALUES (%s, %s::uuid)
                    ON CONFLICT DO NOTHING
                    """,
                    (user_id, bot_id),
                )
    finally:
        conn.close()
    return {"ok": True}


@app.post("/api/bots/{bot_id}/share-session")
async def share_session(bot_id: str, user=Depends(current_user)):
    user_id = user["id"]
    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id FROM bot_model WHERE id = %s::uuid AND user_id = %s",
                    (bot_id, user_id),
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=403, detail="Not the owner")
                cur.execute(
                    """
                    INSERT INTO edit_sessions (id, scenario_id, version, shared)
                    VALUES (%s::uuid, %s::uuid, 0, true)
                    ON CONFLICT (scenario_id) DO UPDATE SET shared = true
                    """,
                    (str(uuid.uuid4()), bot_id),
                )
    finally:
        conn.close()
    return {"ok": True}


@app.put("/api/bots/{bot_id}")
async def update_bot(bot_id: str, payload: dict, user=Depends(current_user)):
    user_id = user["id"]
    name = (payload.get("name") or "").strip() or "Без имени"
    scenario = payload.get("scenario") or {}

    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE bot_model
                    SET name = %s,
                        scenario = %s::jsonb,
                        updated_at = now()
                    WHERE id = %s::uuid AND user_id = %s
                    RETURNING id, name, scenario, version, created_at, updated_at
                    """,
                    (name, Json(scenario), bot_id, user_id),
                )

                row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Bot not found")

    return _bot_to_dict(row)


@app.put("/api/bots/{bot_id}/collab-save")
async def collab_save_bot(bot_id: str, payload: dict, user=Depends(current_user)):
    name = (payload.get("name") or "").strip() or "Без имени"
    scenario = payload.get("scenario") or {}

    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE bot_model
                    SET name = %s, scenario = %s::jsonb, updated_at = now()
                    WHERE id = %s::uuid
                    RETURNING id, name, scenario, version, created_at, updated_at
                    """,
                    (name, Json(scenario), bot_id),
                )
                row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Bot not found")

    return _bot_to_dict(row)


@app.post("/api/bots/copy/{source_id}")
async def copy_bot(source_id: str, user=Depends(current_user)):
    user_id = user["id"]

    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT name, scenario FROM bot_model WHERE id = %s::uuid",
                    (source_id,),
                )
                source = cur.fetchone()
                if not source:
                    raise HTTPException(status_code=404, detail="Bot not found")

                new_id = str(uuid.uuid4())
                cur.execute(
                    """
                    INSERT INTO bot_model (id, user_id, name, scenario, version)
                    VALUES (%s::uuid, %s, %s, %s::jsonb, 0)
                    RETURNING id, name, scenario, version, created_at, updated_at
                    """,
                    (new_id, user_id, source["name"] + " (copy)", Json(source["scenario"])),
                )
                row = cur.fetchone()
    finally:
        conn.close()

    return _bot_to_dict(row)


@app.delete("/api/bots/{bot_id}")
async def delete_bot(bot_id: str, user=Depends(current_user)):
    user_id = user["id"]

    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM bot_model WHERE id = %s::uuid AND user_id = %s",
                    (bot_id, user_id),
                )
                if cur.rowcount == 0:
                    raise HTTPException(status_code=404, detail="Bot not found")
    finally:
        conn.close()

    return {"ok": True}


@app.get("/api/collab/scenarios/{bot_id}")
async def get_collab_scenario_meta(bot_id: str, user=Depends(current_user)):
    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, name, scenario, version, created_at, updated_at, user_id
                    FROM bot_model
                    WHERE id = %s::uuid
                    """,
                    (bot_id,),
                )
                row = cur.fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Bot not found")
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "scenario": row["scenario"],
        "version": int(row.get("version", 0) or 0),
        "is_owner": row["user_id"] == user["id"],
    }
