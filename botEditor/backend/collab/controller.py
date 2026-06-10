from fastapi import WebSocket
from typing import Dict, Set

class CollaborationController:
    def __init__(self):
        # Структура: {scenario_id: {user_id: WebSocket}}
        self.active_connections: Dict[str, Dict[int, WebSocket]] = {}

    async def connect(self, websocket: WebSocket, scenario_id: str, user_id: int):
        await websocket.accept()
        if scenario_id not in self.active_connections:
            self.active_connections[scenario_id] = {}
        self.active_connections[scenario_id][user_id] = websocket
        print(f"User {user_id} connected to session {scenario_id}")

    def disconnect(self, scenario_id: str, user_id: int):
        if scenario_id in self.active_connections:
            if user_id in self.active_connections[scenario_id]:
                del self.active_connections[scenario_id][user_id]
            if not self.active_connections[scenario_id]:
                del self.active_connections[scenario_id]
        print(f"User {user_id} disconnected from session {scenario_id}")

    async def broadcast(self, scenario_id: str, message: dict, exclude_user: int = None):
        if scenario_id in self.active_connections:
            for user_id, ws in self.active_connections[scenario_id].items():
                if user_id != exclude_user:
                    await ws.send_json(message)

    async def close_session(self, session_id: str):
        """Рассылает сигнал о закрытии и отключает всех участников"""
        if session_id in self.active_connections:
            # Копируем список, чтобы безопасно удалять элементы при итерации
            connections = list(self.active_connections[session_id].values())
            for ws in connections:
                try:
                    await ws.send_json({"type": "session_closed"})
                    await ws.close(code=1000, reason="Session closed by owner")
                except Exception:
                    pass
            del self.active_connections[session_id]
            print(f"Session {session_id} forcefully closed.")

collab_controller = CollaborationController()
