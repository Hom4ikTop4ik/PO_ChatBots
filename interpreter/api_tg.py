# api_tg.py
import logging
from typing import Optional, List, Dict, Any
from aiogram import Bot, Dispatcher, types
from aiogram.filters import CommandStart
from bot_api_interface import BotAPI

# Настройка логирования для этого файла
logger = logging.getLogger(__name__)

class TelegramAPI(BotAPI):
    """
    Адаптер Telegram на aiogram 3.x.
    Работает в асинхронном режиме: отправляет запросы и сразу возвращает управление.
    Входящие сообщения обрабатываются через хендлеры и передаются в resume_dialog.
    """
    def __init__(self, token: str, interpreter = None):
        self.bot = Bot(token=token)
        self.dp = Dispatcher()
        self.interpreter = interpreter
        
        # --- Регистрация хендлеров ---
        # 1. Сначала команды (/start)
        self.dp.message.register(self.cmd_start, CommandStart())
        
        # 2. Обработка нажатий на кнопки (CallbackQuery)
        # Это ОБЯЗАТЕЛЬНО для работы get_choice
        self.dp.callback_query.register(self.handle_callback)
        
        # 3. Текстовые сообщения (ловится всё остальное)
        self.dp.message.register(self.handle_text)

    def set_interpreter(self, interpreter):
        """Если интерпретатор создается позже API, можно использовать этот метод"""
        self.interpreter = interpreter

    async def run(self):
        logger.info("Starting Telegram Polling...")
        await self.dp.start_polling(self.bot)

    # --- Implementation of BotAPI (Methods called by Interpreter) ---
    
    async def send_message(self, user_id: int, text: str):
        try:
            await self.bot.send_message(chat_id=user_id, text=text)
        except Exception as e:
            logger.error(f"Error sending message to {user_id}: {e}")

    async def get_message(self, user_id: int, prompt: Optional[str] = None) -> Optional[str]:
        """
        Интерпретатор просит текст.
        Мы отправляем промпт (если есть) и выходим.
        Ничего не возвращаем, чтобы интерпретатор ушел в состояние 'wait'.
        """
        if prompt:
            await self.send_message(user_id, prompt)
        return None

    async def get_choice(self, user_id: int, prompt: str, choices: list) -> Optional[str]:
        """
        Интерпретатор просит выбор.
        Мы рисуем кнопки и выходим.
        """
        # choices: [{"label": "Да", "id": "btn_1", ...}]
        kb = types.InlineKeyboardMarkup(inline_keyboard=[])
        
        for ch in choices:
            # Важно: callback_data имеет лимит 64 байта.
            # Мы используем ch['id'], так как это внутренний ID кнопки.
            btn = types.InlineKeyboardButton(text=ch["label"], callback_data=str(ch["id"]))
            kb.inline_keyboard.append([btn])
        
        try:
            await self.bot.send_message(chat_id=user_id, text=prompt, reply_markup=kb)
        except Exception as e:
            logger.error(f"Error sending choice to {user_id}: {e}")

        return None

    # --- Handlers (Events from Telegram) ---

    async def cmd_start(self, message: types.Message):
        """Обработка /start — начало новой сессии"""
        user_id = message.from_user.id
        logger.info(f"User {user_id} started dialog")
        
        meta = {
            "username": message.from_user.username or "",
            "first_name": message.from_user.first_name or "",
            "user_id": user_id
        }
        
        # Запускаем диалог с нуля
        if self.interpreter:
            await self.interpreter.start_dialog(user_id, meta)

    async def handle_text(self, message: types.Message):
        """Обработка обычного текста"""
        user_id = message.from_user.id
        text = message.text
        
        # Передаем текст в интерпретатор как input_data
        if self.interpreter:
            await self.interpreter.resume_dialog(user_id, text)

    async def handle_callback(self, callback: types.CallbackQuery):
        """
        Обработка нажатия на кнопку.
        Сюда прилетает то, что мы положили в callback_data (id опции).
        """
        user_id = callback.from_user.id
        data = callback.data # Это ID кнопки
        
        # Обязательно отвечаем телеграму, чтобы убрать часики с кнопки
        await callback.answer()
        
        # Передаем ID кнопки в интерпретатор
        if self.interpreter:
            # Можно опционально удалить кнопки после нажатия, чтобы юзер не кликал дважды:
            # await callback.message.edit_reply_markup(reply_markup=None)
            
            await self.interpreter.resume_dialog(user_id, data)
