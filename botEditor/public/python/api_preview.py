# api_preview.py
from typing import Optional, List, Dict, Any
from bot_api_interface import BotAPI

class PreviewAPI(BotAPI):
    """
    Адаптер для работы в браузере через Pyodide.
    Взаимодействует с JSBridge для отрисовки интерфейса.
    
    Архитектура: Event-Driven.
    Методы get_message и get_choice НЕ ждут ввода пользователя.
    Они отправляют команду в JS ("покажи инпут/кнопки") и сразу завершаются.
    
    Ответ от пользователя придет позже через вызов 
    interpreter.resume_dialog(...) из main_preview.py.
    """

    def __init__(self, js_bridge):
        self.js_bridge = js_bridge

    async def send_message(self, user_id: int, text: str):
        """Просто выводит сообщение бота в чат."""
        # Второй аргумент True означает is_bot=True
        await self.js_bridge.add_message(text, True)

    async def get_message(self, user_id: int, prompt: Optional[str] = None) -> None:
        """
        Активирует режим ввода текста в UI.
        Возвращает None, сигнализируя интерпретатору, что нужно сохранить состояние и ждать события.
        """
        if prompt:
            await self.send_message(user_id, prompt)

        # Вызываем метод JS, который разблокирует поле ввода или покажет индикатор ожидания
        await self.js_bridge.activate_input_mode()
        
        # Возвращаем None -> интерпретатор поймет, что нужно выйти в 'wait'
        return None

    async def get_choice(self, user_id: int, prompt: str, choices: List[Dict[str, Any]]) -> None:
        """
        Выводит кнопки выбора в UI.
        Возвращает None, сигнализируя интерпретатору, что нужно сохранить состояние и вернуться позже, когда пользователь нажмёт на выбор.
        """
        # Передаем текст и список опций в JS
        # choices ожидает формат списка dict: [{'label': 'Yes', 'id': 'btn1', ...}, ...]
        await self.js_bridge.show_choices(prompt, choices)
        
        return None
