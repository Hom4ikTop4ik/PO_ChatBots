from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional

class BotAPI(ABC):
    @abstractmethod
    async def send_message(self, user_id: int, text: str):
        pass

    @abstractmethod
    async def get_message(self, user_id: int, prompt: Optional[str] = None) -> Optional[str]:
        """
        Preview: возвращает str (ждет ввода).
        Telegram: возвращает None (отправляет и выходит).
        """
        pass

    @abstractmethod
    async def get_choice(self, user_id: int, prompt: str, choices: List[Dict[str, Any]]) -> Optional[str]:
        """
        Preview: возвращает id опции (ждет клика).
        Telegram: возвращает None.
        """
        pass
