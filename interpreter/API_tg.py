# API_tg.py
import asyncio
import logging
from typing import Dict, Any, List, Optional

from aiogram import Bot, Dispatcher
from aiogram.filters import CommandStart
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


class TelegramAPI:
    """
    Адаптер Telegram на aiogram.
    Предоставляет:
      - send_message(user_id, text)
      - get_message(user_id, prompt) -> str
      - get_choice(user_id, text, choices) -> str (value = option id)
    Адаптер вызывает методы интерпретатора:
      - interpreter.start_dialog(user_id, init_meta)
      - interpreter.resume_dialog(user_id, input_data)
    """

    def __init__(self, token: str):
        self.bot = Bot(token=token)
        self.dp = Dispatcher()
        self.interpreter = None  # будет установлен в main

        # futures для ожиданий конкретных пользователей
        self._pending_text: Dict[int, asyncio.Future] = {}
        self._pending_choice: Dict[int, asyncio.Future] = {}

        # регистрируем хендлеры
        self.dp.message.register(self._handle_user_message)
        self.dp.message.register(self._handle_start_command, CommandStart())
        self.dp.callback_query.register(self._handle_callback_query)

    def set_interpreter(self, interpreter):
        """Установить ссылку на интерпретатор (вызывается в main)."""
        self.interpreter = interpreter

    # -------------------------
    # handlers
    # -------------------------
    async def _handle_start_command(self, message: Message):
        user_id = message.from_user.id
        init_meta = {
            "username": message.from_user.username or "",
            "first_name": message.from_user.first_name or "",
            "user_id": user_id
        }
        # Передаём управление интерпретатору (не блокируем хендлер)
        logger.info(f"/start от {user_id}")
        if self.interpreter:
            await self.interpreter.start_dialog(user_id, init_meta)
        else:
            await message.answer("Система не инициализирована.")

    # async def _handle_user_message(self, message: Message):
    #     user_id = message.from_user.id
    #     text = message.text or ""

    #     # 1) Если ожидаем текст через Future → resolve
    #     future = self._pending_text.pop(user_id, None)
    #     if future:
    #         if not future.done():
    #             future.set_result(text)
    #         return

    #     # 2) Проверяем состояние интерпретатора
    #     if self.interpreter:
    #         session = self.interpreter.load_state(user_id)

    #         # Если сессия активна и step==1 → это ожидаемый ввод для getMessage
    #         if session and session.get("active", False) and session.get("step", 0) == 1:
    #             await self.interpreter.resume_dialog(user_id, text)
    #             return

    #     # 3) Иначе подсказываем пользователю
    #     await message.answer("Напишите /start чтобы начать")

    async def _handle_user_message(self, message: Message):
        user_id = message.from_user.id
        text = message.text

        if text == "/start":
            # проверяем, есть ли активная сессия
            session = self.interpreter.load_state(user_id)
            if session and session.get("active", False):
                # продолжаем текущую сессию
                await message.answer("Сессия уже активна. Продолжаем диалог...")
                await self.interpreter._process_blocks(user_id)
            else:
                # создаём новую сессию
                await self.interpreter.start_new_session(user_id)
                await self.interpreter._process_blocks(user_id)
            return

        # загрузка состояния пользователя
        session = self.interpreter.load_state(user_id)
        if not session or not session.get("active", False):
            # сессии нет или она неактивна → просим начать с /start
            await message.answer("Напишите /start чтобы начать")
            return

        # продолжаем диалог с пользователем
        await self.interpreter.resume_dialog(user_id, text)



    async def _handle_callback_query(self, callback: CallbackQuery):
        user_id = callback.from_user.id

        # загрузка состояния
        session = self.interpreter.load_state(user_id)
        if not session or not session.get("active", False):
            await callback.answer("Сессия не активна. Напишите /start")
            return

        # продолжаем диалог
        await self.interpreter.resume_dialog(user_id, callback.data)
        await callback.answer()


    # -------------------------
    # API для интерпретатора
    # -------------------------
    async def send_message(self, user_id: int, text: str):
        await self.bot.send_message(chat_id=user_id, text=text)

    async def get_message(self, user_id: int, prompt: Optional[str] = None) -> str:
        """
        Отправляет prompt (если задан) и ожидает текстовое сообщение от user_id.
        Возвращает текст.
        """
        if prompt:
            await self.send_message(user_id, prompt)

        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()
        self._pending_text[user_id] = fut
        result = await fut
        return result

    async def get_choice(self, user_id: int, text: str, choices: List[Dict[str, Any]]) -> str:
        """
        Отправляет inline-клавиатуру. choices = [{"text": "...", "value": "opt_id"}, ...]
        Возвращает значение value (callback_data) выбранной кнопки.
        """
        keyboard = InlineKeyboardMarkup(inline_keyboard=[])
        for ch in choices:
            btn = InlineKeyboardButton(text=ch["text"], callback_data=ch["value"])
            keyboard.inline_keyboard.append([btn])

        await self.bot.send_message(chat_id=user_id, text=text, reply_markup=keyboard)

        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()
        self._pending_choice[user_id] = fut
        result = await fut
        return result

    # -------------------------
    # запуск polling
    # -------------------------
    async def run(self):
        logger.info("Запуск Telegram polling...")
        await self.dp.start_polling(self.bot)
