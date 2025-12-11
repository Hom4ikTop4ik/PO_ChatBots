# main_preview.py
import asyncio
import json
import logging
from typing import Dict, Any

from api_preview import PreviewAPI
from bot_interpreter import BotInterpreter

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class PreviewManager:
    def __init__(self, js_bridge):
        self.js_bridge = js_bridge
        self.interpreter = None
        self.session_id = None
    
    async def start_preview(self, bot_model_json: str) -> Dict[str, Any]:
        try:
            bot_model = json.loads(bot_model_json)
            api = PreviewAPI(self.js_bridge)
            self.interpreter = BotInterpreter(bot_model, api)
            
            import time
            self.session_id = f"preview_{int(time.time() * 1000)}"
            
            init_meta = {
                "user_id": self.session_id,
                "username": "preview_user",
                "first_name": "Preview"
            }
            
            asyncio.create_task(self.interpreter.start_dialog(self.session_id, init_meta))
            return {"status": "started", "session_id": self.session_id}
            
        except Exception as e:
            import traceback
            return {"status": "error", "error": str(e)}
    
    async def provide_input(self, input_text: str) -> Dict[str, Any]:
        if not self.interpreter:
            return {"status": "error", "error": "Интерпретатор не инициализирован"}
        
        try:
            await self.interpreter.resume_dialog(self.session_id, input_text)
            return {"status": "input_provided"}
            
        except Exception as e:
            import traceback
            return {"status": "error", "error": str(e)}
    
    def cleanup(self) -> Dict[str, Any]:
        self.interpreter = None
        self.session_id = None
        return {"status": "cleaned"}

preview_manager = None

def init_preview(js_bridge):
    global preview_manager
    preview_manager = PreviewManager(js_bridge)
    return {"status": "initialized"}

async def start_preview(bot_model_json: str) -> Dict[str, Any]:
    global preview_manager
    if not preview_manager:
        return {"status": "error", "error": "Превью не инициализировано"}
    return await preview_manager.start_preview(bot_model_json)

async def provide_user_input(input_text: str) -> Dict[str, Any]:
    global preview_manager
    if not preview_manager:
        return {"status": "error", "error": "Превью не инициализировано"}
    return await preview_manager.provide_input(input_text)

def cleanup_preview() -> Dict[str, Any]:
    global preview_manager
    if preview_manager:
        return preview_manager.cleanup()
    return {"status": "already_cleaned"}
