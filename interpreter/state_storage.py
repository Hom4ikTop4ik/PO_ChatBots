from abc import ABC, abstractmethod
from typing import Dict, Any, Optional

class StateStorage(ABC):
    @abstractmethod
    async def save_state(self, user_id: int, state: Dict[str, Any]):
        """Сохранить состояние сессии пользователя"""
        pass

    @abstractmethod
    async def load_state(self, user_id: int) -> Optional[Dict[str, Any]]:
        """Загрузить состояние сессии пользователя"""
        pass

class MemoryStorage(StateStorage):
    """Хранение в оперативной памяти (сбрасывается при перезапуске)"""
    def __init__(self):
        self._data = {}

    async def save_state(self, user_id: int, state: Dict[str, Any]):
        # В реальном коде лучше делать deepcopy, чтобы избежать мутаций по ссылке
        self._data[user_id] = state

    async def load_state(self, user_id: int) -> Optional[Dict[str, Any]]:
        return self._data.get(user_id)
