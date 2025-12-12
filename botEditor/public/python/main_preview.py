# main_preview.py
import json
import asyncio
# 1. ВАЖНО: Импортируем create_proxy
from pyodide.ffi import create_proxy

from bot_interpreter import BotInterpreter
from api_preview import PreviewAPI
from state_storage import MemoryStorage

# Глобальные переменные
interpreter = None
api = None
storage = None
PREVIEW_USER_ID = 777

# --- Обработчики входящих событий ---

async def process_user_text(text):
    """Будет вызвана из JSBridge при вводе текста"""
    if interpreter:
        await interpreter.resume_dialog(PREVIEW_USER_ID, text)

async def process_user_choice(choice_id):
    """Будет вызвана из JSBridge при выборе кнопки"""
    if interpreter:
        await interpreter.resume_dialog(PREVIEW_USER_ID, choice_id)

# --- Инициализация ---

def init_preview(js_bridge):
    global api, storage
    
    print("PYTHON: Init started...")
    
    api = PreviewAPI(js_bridge)
    storage = MemoryStorage()
    
    # 2. ВАЖНО: Оборачиваем функции в proxy перед передачей в JS.
    # Это предотвращает ошибку "borrowed proxy was automatically destroyed"
    text_handler_proxy = create_proxy(process_user_text)
    choice_handler_proxy = create_proxy(process_user_choice)
    
    # Передаем прокси-объекты
    js_bridge.bindPythonCallbacks(text_handler_proxy, choice_handler_proxy)
    
    print("PYTHON: Callbacks registered successfully with create_proxy")

async def start_preview(bot_model_json):
    global interpreter
    try:
        # Парсинг модели
        if isinstance(bot_model_json, str):
            model = json.loads(bot_model_json)
        else:
            model = bot_model_json
            
        interpreter = BotInterpreter(model, api, storage)
        
        meta = {"username": "User", "first_name": "Test", "user_id": PREVIEW_USER_ID}
        await interpreter.start_dialog(PREVIEW_USER_ID, meta)
        
    except Exception as e:
        print(f"PYTHON ERROR: {e}")
