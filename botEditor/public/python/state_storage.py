import copy
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
        """Сохраняет глубокую копию состояния пользователя"""
        try:
            # Создаем глубокую копию
            self._data[user_id] = copy.deepcopy(state)
        except Exception as e:
            # Обработка ошибок копирования
            print(f"Ошибка при копировании состояния: {e}")
            # Fallback: поверхностная копия
            self._data[user_id] = state.copy()

    async def load_state(self, user_id: int) -> Optional[Dict[str, Any]]:
        """Возвращает глубокую копию состояния пользователя или None"""
        if user_id in self._data:
            try:
                return copy.deepcopy(self._data[user_id])
            except Exception as e:
                print(f"Ошибка при копировании загружаемого состояния: {e}")
                # Если не удалось сделать deepcopy, возвращаем поверхностную копию
                return self._data[user_id].copy()
        return None
