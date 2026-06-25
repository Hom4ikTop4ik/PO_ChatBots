# bot_interpreter.py
import logging
import aiohttp
from typing import Dict, Any, Optional

# Импортируем наши интерфейсы
from bot_api_interface import BotAPI
from state_storage import StateStorage, MemoryStorage

logger = logging.getLogger(__name__)

class BotInterpreter:
    """
    Асинхронный интерпретатор сценариев.
    Работает по принципу конечного автомата (State Machine).
    Не блокирует поток ожиданиям ввода пользователя.
    """

    def __init__(self, bot_model: Dict[str, Any], api: BotAPI, storage: Optional[StateStorage] = None):
        self.model = bot_model
        self.api = api
        # Если хранилище не передали, используем in-memory (для тестов)
        self.storage = storage if storage else MemoryStorage()
        
        self.blocks = {b["Block_id"]: b for b in bot_model["Blocks"]}
        top_edges = bot_model.get("Edges", [])
        if top_edges:
            for block in self.blocks.values():
                conns = block.get("Connections", {})
                if not conns.get("OutEdges"):
                    src = block["Block_id"]
                    conns["OutEdges"] = [
                        {"id": e.get("id", ""), "target": e["target"],
                         **( {"sourceHandle": e["sourceHandle"]} if e.get("sourceHandle") else {} )}
                        for e in top_edges if e.get("source") == src
                    ]
        
        # Глобальные переменные (конфигурация)
        raw_vars = self.model.get("GlobalVariables", [])
        self.global_vars = {}
        for v in raw_vars:
            if isinstance(v, dict):
                name = v.get("name", "").strip()
                value = v.get("default", v.get("value", ""))
                if name:
                    self.global_vars[name] = value
            elif isinstance(v, str) and "=" in v:
                name, _, value = v.partition("=")
                if name.strip():
                    self.global_vars[name.strip()] = value.strip()
        print(f"[BotInterpreter] global_vars loaded: {self.global_vars}")

        self.block_handlers = {
            "start": self._handle_start_block,
            "sendMessage": self._handle_send_message_block,
            "getMessage": self._handle_get_message_block,
            "choice": self._handle_choice_block,
            "final": self._handle_final_block,
            "condition": self._handle_condition_block,
            "api": self._handle_api_request_block
        }

    # -------------------------
    # Публичные методы (Lifecycle)
    # -------------------------

    async def start_dialog(self, user_id: int, init_meta: Dict[str, Any]):
        """
        Запуск новой сессии.
        """
        # 1. Инициализация переменных
        variables = self.global_vars.copy()
        variables.update({
            "username": init_meta.get("username", ""),
            "first_name": init_meta.get("first_name", ""),
            "user_id": user_id
        })

        # 2. Создание структуры сессии
        session = {
            "current_block": self.model["Start"],
            "variables": variables,
            "step": 0,      # Текущий шаг внутри блока (0 - вход, 1 - ожидание ввода)
            "active": True
        }

        # 3. Сохранение и запуск
        await self.storage.save_state(user_id, session)
        logger.info(f"Session started for user {user_id}")
        await self._process_blocks(user_id)

    async def resume_dialog(self, user_id: int, input_data: Optional[str]):
        """
        Обработка входящего события (текст или нажатие кнопки).
        """
        session = await self.storage.load_state(user_id)
        
        # Если сессии нет или она завершена
        if not session or not session.get("active"):
            # Можно отправить сообщение в духе "Напишите /start"
            await self.api.send_message(user_id, "Диалог не активен. Напишите /start")
            return

        block_id = session["current_block"]
        block = self.blocks.get(block_id)
        
        if not block:
            logger.error(f"Block {block_id} not found for user {user_id}")
            return

        handler = self.block_handlers.get(block["Type"])
        if handler:
            # Вызываем обработчик текущего блока, передавая input_data
            result = await handler(block, user_id, session, input_data)
            
            # Обрабатываем результат (сохраняем state, переходим к следующему блоку и т.д.)
            should_continue = await self._process_block_result(user_id, session, result)
            
            # Если блок завершился успешно и требует перехода дальше — запускаем цикл
            if should_continue:
                await self._process_blocks(user_id)

    # -------------------------
    # Ядро (Core Loop)
    # -------------------------

    async def _process_blocks(self, user_id: int):
        """
        Крутит цикл блоков, которые выполняются автоматически (без участия пользователя).
        Останавливается, когда блок возвращает 'wait' (ждет ввода) или 'break' (конец).
        """
        while True:
            # Всегда перезагружаем состояние, чтобы иметь актуальные данные
            session = await self.storage.load_state(user_id)
            if not session or not session.get("active"):
                break

            block_id = session["current_block"]
            block = self.blocks.get(block_id)
            if not block:
                break

            handler = self.block_handlers.get(block["Type"])
            if not handler:
                logger.error(f"No handler for block type {block.get('Type')}")
                break
            
            # Вызов handler БЕЗ input_data (автоматический шаг)
            # step должен быть 0 (или специфичный для логики блока)
            result = await handler(block, user_id, session, input_data=None)

            # Обработка результата
            should_continue = await self._process_block_result(user_id, session, result)

            if not should_continue:
                # Если wait или break — выходим из цикла, освобождаем worker
                break

    async def _process_block_result(self, user_id: int, session: Dict[str, Any], result: str) -> bool:
        """
        Логика переходов и сохранения.
        Возвращает True, если нужно продолжать цикл (_process_blocks).
        Возвращает False, если нужно остановиться (ждать ввода или конец).
        """
        
        if result == "continue":
            # Стандартный переход: берем первый выход
            current_block = self.blocks.get(session["current_block"])
            out_conns = current_block.get("Connections", {}).get("Out", [])
            
            if out_conns:
                session["current_block"] = out_conns[0]
                session["step"] = 0
                await self.storage.save_state(user_id, session)
                return True # Продолжаем цикл
            else:
                # Тупик — завершаем диалог
                session["active"] = False
                await self.storage.save_state(user_id, session)
                return False

        elif result == "manual_switch":
            # Блок САМ изменил session["current_block"] (Choice, Condition)
            # Нам нужно просто сбросить шаг и сохранить
            session["step"] = 0
            await self.storage.save_state(user_id, session)
            return True # Продолжаем цикл с новым блоком

        elif result == "wait":
            # Блок ждет ввода пользователя. Сохраняем состояние (обычно step=1) и выходим.
            await self.storage.save_state(user_id, session)
            return False

        elif result == "break":
            # Явное завершение диалога
            session["active"] = False
            await self.storage.save_state(user_id, session)
            return False
            
        return False

    # -------------------------
    # Обработчики блоков
    # -------------------------

    async def _handle_start_block(self, block, user_id, session, input_data):
        return "continue"

    async def _handle_send_message_block(self, block, user_id, session, input_data):
        text = self._format_text(block["Params"]["message"], session["variables"])
        await self.api.send_message(user_id, text)
        return "continue"

    async def _handle_get_message_block(self, block, user_id, session, input_data):
        """
        Step 0: Отправить вопрос, установить step=1, вернуть 'wait'.
        Step 1: Проверить input_data. Если ок -> сохранить, 'continue'. Иначе -> ошибка, 'wait'.
        """
        step = session.get("step", 0)
        var_name = block["Params"]["var"]
        expected_type = block["Params"].get("type", "string")

        # --- ФАЗА 1: Обработка ответа (Resume) ---
        if step == 1 and input_data is not None:
            try:
                val = self._cast_type(input_data, expected_type)
                session["variables"][var_name] = val
                session["step"] = 0 
                return "continue"
            except ValueError:
                await self.api.send_message(user_id, f"Ошибка: ожидается тип {expected_type}. Попробуйте снова.")
                # Остаемся на шаге 1, ждем новый ввод
                return "wait"

        # --- ФАЗА 0: Запрос (Entry) ---
        if step == 0:
            prompt = self._format_text(block["Params"]["message"], session["variables"])
            # Отправляем сообщение и говорим API "включи ввод"
            await self.api.get_message(user_id, prompt)
            
            session["step"] = 1
            return "wait"

        return "wait"

    async def _handle_choice_block(self, block, user_id, session, input_data):
        """
        Step 0: Отправить кнопки, step=1, 'wait'.
        Step 1: Найти кнопку по ID. Если ок -> manual_switch. Иначе -> 'wait'.
        """
        step = session.get("step", 0)

        # --- ФАЗА 1: Обработка выбора ---
        if step == 1 and input_data is not None:
            options = block["Params"]["options"]
            # input_data — это ID кнопки (callback_data)
            selected = next((o for o in options if str(o["id"]) == str(input_data)), None)
            
            if not selected:
                # Если нажата старая кнопка или мусор
                await self.api.send_message(user_id, "Эта опция уже недоступна или неверна.")
                return "wait"

            # Сохраняем значение
            var_name = block["Params"]["var"]
            session["variables"][var_name] = selected["value"]

            out_edges = block["Connections"].get("OutEdges", [])
            if out_edges:
                target = next((e["target"] for e in out_edges if str(e.get("sourceHandle")) == str(selected["id"])), None)
                if target:
                    session["current_block"] = target
                    return "manual_switch"

            idx = options.index(selected)
            out_conns = block["Connections"].get("Out", [])
            if idx < len(out_conns):
                session["current_block"] = out_conns[idx]
                return "manual_switch"
            else:
                logger.warning(f"Choice block {block['Block_id']}: branch {idx} not connected")
                return "break"

        # --- ФАЗА 0: Отрисовка кнопок ---
        if step == 0:
            prompt = self._format_text(block["Params"]["prompt"], session["variables"])
            # Формируем список для API
            api_choices = [{"label": o["label"], "id": o["id"]} for o in block["Params"]["options"]]
            
            await self.api.get_choice(user_id, prompt, api_choices)
            
            session["step"] = 1
            return "wait"

        return "wait"

    async def _handle_condition_block(self, block, user_id, session, input_data):
        """
        Вычисляет условие и меняет current_block.
        """
        condition_expr = block["Params"].get("expression", block["Params"].get("condition", "False"))
        try:
            res = eval(condition_expr, {"__builtins__": {}}, session["variables"])
        except Exception as e:
            logger.error(f"Condition error user {user_id}: {e}")
            res = False

        out_edges = block["Connections"].get("OutEdges", [])
        if out_edges:
            handle = "true" if res else "false"
            target = next((e["target"] for e in out_edges if str(e.get("sourceHandle", "")).lower() == handle), None)
            if target:
                session["current_block"] = target
                return "manual_switch"

        out_conns = block["Connections"].get("Out", [])
        idx = 0 if res else 1
        if idx < len(out_conns):
            session["current_block"] = out_conns[idx]
            return "manual_switch"

        return "break"

    async def _handle_api_request_block(self, block, user_id, session, input_data):
        """
        Асинхронный HTTP запрос с поддержкой переменных.
        Использует JavaScript fetch в Pyodide для обхода SSL проблем.
        """
        params = block["Params"]
        
        # Подставляем переменные
        url = self._format_text(params.get("url", ""), session["variables"])
        print(f"[BotInterpreter] API block URL after substitution: {url}")
        method = params.get("method", "GET").upper()
        
        # Заголовки
        headers_raw = params.get("headers", {})
        headers = {}
        for key, value in headers_raw.items():
            if isinstance(value, str):
                headers[key] = self._format_text(value, session["variables"])
            else:
                headers[key] = value
        
        # Тело запроса
        body_raw = params.get("body", {})
        if isinstance(body_raw, str):
            try:
                import json
                body_raw = json.loads(body_raw)
            except:
                body_raw = {}
        body = self._substitute_in_dict(body_raw, session["variables"])
        
        # Маппинг переменных
        var_mapping = params.get("variables", {})
        var_mapping_substituted = {}
        for json_field, var_name in var_mapping.items():
            var_mapping_substituted[json_field] = self._format_text(var_name, session["variables"])

        if not url:
            logger.warning(f"API block {block['Block_id']}: URL is empty")
            return "break"

        try:
            # Проверяем, в Pyodide ли мы
            try:
                from js import fetch, JSON, Headers
                import asyncio
                is_pyodide = True
            except ImportError:
                is_pyodide = False
            
            if is_pyodide:
                # Используем JavaScript fetch
                fetch_options = {
                    "method": method,
                    "headers": headers,
                    "mode": "cors",
                }
                
                # Добавляем тело для POST/PUT
                if method in ["POST", "PUT", "PATCH"] and body:
                    import json
                    fetch_options["body"] = json.dumps(body)
                    if "Content-Type" not in headers:
                        fetch_options["headers"]["Content-Type"] = "application/json"
                
                # Выполняем запрос через JS fetch
                response = await fetch(url, fetch_options)
                status = response.status
                
                # Получаем ответ
                content_type = response.headers.get("Content-Type", "")
                if "application/json" in content_type:
                    js_data = await response.json()
                    resp_data = js_data.to_py() if hasattr(js_data, 'to_py') else dict(js_data)
                else:
                    js_text = await response.text()
                    resp_data = {"text": str(js_text)}
                    
            else:
                # Используем aiohttp (серверная версия)
                import aiohttp
                async with aiohttp.ClientSession() as client:
                    if method == "GET":
                        async with client.get(url, headers=headers) as resp:
                            status = resp.status
                            content_type = resp.headers.get("Content-Type", "")
                            if "application/json" in content_type:
                                resp_data = await resp.json()
                            else:
                                resp_data = {"text": await resp.text()}
                    elif method == "POST":
                        async with client.post(url, json=body, headers=headers) as resp:
                            status = resp.status
                            content_type = resp.headers.get("Content-Type", "")
                            if "application/json" in content_type:
                                resp_data = await resp.json()
                            else:
                                resp_data = {"text": await resp.text()}
                    elif method == "PUT":
                        async with client.put(url, json=body, headers=headers) as resp:
                            status = resp.status
                            content_type = resp.headers.get("Content-Type", "")
                            if "application/json" in content_type:
                                resp_data = await resp.json()
                            else:
                                resp_data = {"text": await resp.text()}
                    elif method == "DELETE":
                        async with client.delete(url, headers=headers) as resp:
                            status = resp.status
                            content_type = resp.headers.get("Content-Type", "")
                            if "application/json" in content_type:
                                resp_data = await resp.json()
                            else:
                                resp_data = {"text": await resp.text()}
                    else:
                        logger.error(f"Unsupported method: {method}")
                        return "break"

            # Успех или провал
            is_success = 200 <= status < 300
            
            # Сохраняем переменные
            if is_success:
                for json_field, var_name in var_mapping_substituted.items():
                    value = self._get_nested_value(resp_data, json_field)
                    if value is not None:
                        session["variables"][var_name] = value
                        logger.debug(f"Saved {var_name} = {value} from {json_field}")

            # Выбираем выход
            out_idx = 0 if is_success else 1
            out_conns = block["Connections"].get("Out", [])
            
            if out_idx < len(out_conns):
                session["current_block"] = out_conns[out_idx]
                return "manual_switch"

        except Exception as e:
            logger.error(f"API Request failed for user {user_id}: {e}")
            import traceback
            traceback.print_exc()
            
            # Пытаемся пойти по ветке Fail
            out_conns = block["Connections"].get("Out", [])
            if len(out_conns) > 1:
                session["current_block"] = out_conns[1]
                return "manual_switch"
            return "break"

        return "break"

    def _get_nested_value(self, data: dict, path: str):
        """
        Получает значение из вложенного словаря по пути вида "user.id" или "weather.0.temp"
        """
        if not path or not data:
            return None
        
        keys = path.split(".")
        current = data
        
        for key in keys:
            if isinstance(current, dict) and key in current:
                current = current[key]
            elif isinstance(current, list) and key.isdigit():
                idx = int(key)
                if idx < len(current):
                    current = current[idx]
                else:
                    return None
            else:
                return None
        
        return current

    def _substitute_in_dict(self, obj, variables: Dict[str, Any]):
        """
        Рекурсивно подставляет переменные во все строки внутри dict/list.
        """
        if isinstance(obj, dict):
            result = {}
            for key, value in obj.items():
                # Подставляем переменные в ключи (если они строки)
                new_key = self._format_text(key, variables) if isinstance(key, str) else key
                result[new_key] = self._substitute_in_dict(value, variables)
            return result
        elif isinstance(obj, list):
            return [self._substitute_in_dict(item, variables) for item in obj]
        elif isinstance(obj, str):
            return self._format_text(obj, variables)
        else:
            return obj

    async def _handle_final_block(self, block, user_id, session, input_data):
        msg = "Диалог завершён. Результаты:\n"
        for k, v in session["variables"].items():
            if k not in ("username", "first_name", "user_id"):
                msg += f"{k}: {v}\n"
        await self.api.send_message(user_id, msg)
        return "break"

    # -------------------------
    # Утилиты
    # -------------------------
    def _format_text(self, text: str, variables: Dict[str, Any]) -> str:
        # Простая подстановка ${var}
        for k, v in variables.items():
            placeholder = "${" + k + "}"
            if placeholder in text:
                text = text.replace(placeholder, str(v))
        if "${" in text:
            print(f"[BotInterpreter] WARNING: unresolved placeholder in text. Available vars: {list(variables.keys())}")
            logger.warning(f"Unresolved placeholder remains after substitution. Available vars: {list(variables.keys())}")
        return text

    def _cast_type(self, value, expected_type):
        if expected_type == "int":
            return int(value)
        if expected_type == "float":
            return float(value)
        if expected_type == "boolean":
            s = str(value).lower()
            if s in ("true", "1", "yes"): return True
            if s in ("false", "0", "no"): return False
            raise ValueError("Not a boolean")
        return str(value)
