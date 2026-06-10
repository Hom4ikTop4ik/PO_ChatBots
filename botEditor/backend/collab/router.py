from typing import Dict
import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
import jwt
from ..config import JWT_SECRET, JWT_ALG 
from .controller import collab_controller
from .db_utils import (
    save_operation, 
    get_current_scenario_version, 
    get_operations_since_version, 
    update_scenario_version, 
    get_session_scenario_id
)
from .transform import transform

import logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


scenario_locks: Dict[str, asyncio.Lock] = {}

async def get_scenario_lock(scenario_id: str) -> asyncio.Lock:
    """Получить или создать блокировку для сценария"""
    if scenario_id not in scenario_locks:
        scenario_locks[scenario_id] = asyncio.Lock()
    return scenario_locks[scenario_id]

router = APIRouter()

async def get_user_from_token(token: str) -> int:
    logger.info(f"[router.py | TOKEN] Received token: {token}...")

    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        return int(payload.get("sub"))
    except Exception as e:
        logger.error(f"Token validation error: {e}")
        raise HTTPException(status_code=401)

@router.websocket("/ws/{session_id}")
async def websocket_endpoint(
    websocket: WebSocket, 
    session_id: str
):
    logger.info(f"!!! WEBSOCKET CONNECTED to session {session_id} !!!")

    # 1. Получаем токен
    token = websocket.cookies.get("session")
    if not token:
        token = websocket.query_params.get("token")
    
    if not token:
        logger.warning("Missing token")
        await websocket.close(code=1008, reason="Missing token")
        return
    
    # 2. Валидируем пользователя
    try:
        user_id = await get_user_from_token(token)
        logger.info(f"User {user_id} authenticated")
    except HTTPException:
        logger.warning("Invalid token")
        await websocket.close(code=1008, reason="Invalid token")
        return

    # 3. Получаем ID бота (scenario_id) из ID сессии
    scenario_id = get_session_scenario_id(session_id)
    if not scenario_id:
        logger.warning(f"Session {session_id} not found")
        await websocket.close(code=1008, reason="Session not found")
        return
    
    logger.info(f"Session {session_id} -> Scenario {scenario_id}")

    # 4. Подключаем к контроллеру (группируем по session_id)
    await collab_controller.connect(websocket, session_id, user_id)
    
    try:
        while True:
            data = await websocket.receive_json()
            logger.debug(f"Received from user {user_id} in session {session_id}: {data.get('type')}")
            
            if data.get("type") == "op":
                op_data = data.get("operation")
                base_version = op_data.get("base_version", 0)
                
                # Блокировка по session_id
                lock = await get_scenario_lock(session_id)
                
                async with lock:
                    # Используем scenario_id для работы с БД
                    current_version = get_current_scenario_version(scenario_id)
                    processed_op = op_data.copy()
                    
                    # Трансформируем, если версия отстает
                    if base_version < current_version:
                        history = get_operations_since_version(scenario_id, base_version)
                        for past_op in history:
                            past_op_data = past_op.get("data", {})
                            if isinstance(past_op_data, str):
                                past_op_data = json.loads(past_op_data)
                            
                            past_op_formatted = {
                                "op_type": past_op.get("op_type"),
                                "data": past_op_data
                            }
                            
                            processed_op = transform(processed_op, past_op_formatted)
                            if processed_op.get("op_type") == "noop":
                                break
                    
                    # Проверка на noop (отклонение)
                    if processed_op.get("op_type") == "noop":
                        await websocket.send_json({
                            "type": "op_reject",
                            "op_id": processed_op.get("op_id"),
                            "reason": processed_op.get("reason", "Conflict detected")
                        })
                        continue
                    
                    # Сохраняем операцию
                    new_version = current_version + 1
                    
                    try:
                        update_scenario_version(scenario_id, new_version)
                        save_operation(
                            scenario_id, 
                            user_id, 
                            new_version, 
                            processed_op.get("op_type"), 
                            processed_op
                        )
                    except Exception as e:
                        logger.error(f"Failed to save operation: {e}")
                        await websocket.send_json({
                            "type": "op_reject",
                            "op_id": op_data.get("op_id"),
                            "reason": "Failed to save operation"
                        })
                        continue
                    
                    # Broadcast всем участникам сессии (используем session_id)
                    broadcast_msg = {
                        "type": "op_broadcast",
                        "operation": {
                            **processed_op,
                            "user_id": user_id,
                            "applied_version": new_version
                        }
                    }
                    await collab_controller.broadcast(session_id, broadcast_msg, exclude_user=user_id)
                    
                    # ACK автору
                    await websocket.send_json({
                        "type": "op_ack", 
                        "op_id": op_data.get("op_id"), 
                        "new_version": new_version
                    })
                    
                    logger.info(f"Operation {op_data.get('op_id')} applied, new version: {new_version}")
            
            # TODO: обработка других типов сообщений (presence, lock)
            
    except WebSocketDisconnect:
        logger.info(f"User {user_id} disconnected from session {session_id}")
        collab_controller.disconnect(session_id, user_id)
    except Exception as e:
        logger.error(f"Unexpected error in websocket: {e}")
        import traceback
        traceback.print_exc()
        try:
            await websocket.close(code=1011, reason="Internal error")
        except:
            pass
        collab_controller.disconnect(session_id, user_id)
