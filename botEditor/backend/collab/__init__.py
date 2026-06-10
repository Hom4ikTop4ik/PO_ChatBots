from pydantic import BaseModel, Field
from typing import Any, Dict, Optional, Literal
from uuid import UUID
from datetime import datetime

class WsMessage(BaseModel):
    """Базовый класс для всех WebSocket сообщений"""
    type: str



class ClientOperationData(BaseModel):
    op_id: str
    op_type: str
    base_version: int
    data: Dict[str, Any]

class ClientOpMessage(WsMessage):
    type: Literal["op"] = "op"
    operation: ClientOperationData

class ClientPresenceMessage(WsMessage):
    type: Literal["presence"] = "presence"
    # x, y курсора, выделенный блок и подобное
    cursor: Optional[Dict[str, float]] = None 
    selected_node: Optional[str] = None

class ClientLockAcquireMessage(WsMessage):
    type: Literal["lock_acquire"] = "lock_acquire"
    block_id: str
    field_name: str

class ClientLockReleaseMessage(WsMessage):
    type: Literal["lock_release"] = "lock_release"
    block_id: str
    field_name: str



class ServerOpAckMessage(WsMessage):
    type: Literal["op_ack"] = "op_ack"
    op_id: str
    new_version: int

class ServerOpBroadcastMessage(WsMessage):
    type: Literal["op_broadcast"] = "op_broadcast"
    operation: Dict[str, Any]  # Содержит op_id, type, data, user_id, applied_version

class ServerPresenceUpdateMessage(WsMessage):
    type: Literal["presence_update"] = "presence_update"
    participants: Dict[int, Dict[str, Any]] # user_id -> state

class ServerSnapshotMessage(WsMessage):
    type: Literal["snapshot"] = "snapshot"
    version: int
    scenario: Dict[str, Any]
    operation_log: list[Dict[str, Any]] = []
