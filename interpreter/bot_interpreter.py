# bot_interpreter.py
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


class BotInterpreter:
    """
    Платформенно-независимый интерпретатор сценариев.
    Взаимодействие с пользователем только через self.api:
      - send_message(user_id, text)
      - get_message(user_id, prompt) -> str
      - get_choice(user_id, text, choices) -> str (callback_data / option id)
    Состояния хранятся в памяти через save_state/load_state (словарь).
    """

    def __init__(self, bot_model: Dict[str, Any], api: Optional[Any] = None):
        self.model = bot_model
        self.api = api  # должен иметь set_interpreter вызываемый в main
        self.blocks = {b["Block_id"]: b for b in bot_model["Blocks"]}
        self.sessions: Dict[int, Dict[str, Any]] = {}  # user_id -> session dict

        self.block_handlers = {
            "start": self._handle_start_block,
            "sendMessage": self._handle_send_message_block,
            "getMessage": self._handle_get_message_block,
            "choice": self._handle_choice_block,
            "final": self._handle_final_block,
            "condition": self._handle_condition_block,
            "apiRequest": self._handle_api_request_block
        }

    # -------------------------
    # state persistence (in-memory)
    # -------------------------
    def save_state(self, user_id: int, session: Dict[str, Any]):
        """Сохранить/обновить состояние пользователя (в памяти)."""
        self.sessions[user_id] = session

    def load_state(self, user_id: int) -> Optional[Dict[str, Any]]:
        """Загрузить состояние пользователя (или None)."""
        return self.sessions.get(user_id)

    # -------------------------
    # lifecycle: start / resume
    # -------------------------
    async def start_dialog(self, user_id: int, init_meta: Dict[str, Any]):
        """
        Начало диалога: вызывается адаптером при /start.
        init_meta содержит минимум: username, first_name, user_id.
        Также инициализируются GlobalVariables из модели.
        """
        # Собрать начальные переменные из GlobalVariables
        init_vars = {}
        for var in self.model.get("GlobalVariables", []):
            init_vars[var["name"]] = var.get("default", "")

        # Обновить базовые пользовательские поля
        init_vars.update({
            "username": init_meta.get("username", ""),
            "first_name": init_meta.get("first_name", ""),
            "user_id": init_meta.get("user_id", user_id)
        })

        session = {
            "current_block": self.model["Start"],
            "variables": init_vars,
            "step": 0,
            "active": True
        }

        self.save_state(user_id, session)
        logger.info(f"Новая сессия для пользователя {user_id}: {session}")
        await self._process_blocks(user_id)

    async def resume_dialog(self, user_id: int, input_data: Optional[str]):
        """
        Возобновить выполнение диалога при входящих данных пользователя.
        Используется одинаковый pipeline, как в старой системе.
        """

        session = self.load_state(user_id)

        # 1. Если сессии нет — создаём её и запускаем весь процесс блоков
        if not session:
            session = self.create_session(user_id)
            await self._process_blocks(user_id)
            return

        # 2. Если сессия неактивна — просто игнорируем
        if not session.get("active", False):
            return

        block = self.blocks.get(session["current_block"])
        if not block:
            logger.error(f"resume_dialog: блок {session['current_block']} не найден")
            return

        handler = self.block_handlers.get(block["Type"])
        if not handler:
            logger.error(f"resume_dialog: нет обработчика блока {block['Type']}")
            return

        # --- Важно ---
        # 3. Передаём input в блок
        result = await handler(block, user_id, input_data)

        # 4. Обрабатываем результат блока
        await self._process_block_result(user_id, result)

        # 5. Если блок НЕ сказал WAIT — продолжаем ЦИКЛ (как раньше)
        if result != "wait":
            await self._process_blocks(user_id)


    # -------------------------
    # основной цикл обработки блоков
    # -------------------------
    async def _process_blocks(self, user_id: int):
        """Выполняет блоки последовательно, пока блоки не требуют ввода."""
        session = self.load_state(user_id)

        while session and session.get("active"):
            block = self.blocks.get(session["current_block"])
            if not block:
                logger.error(f"process_blocks: блок {session['current_block']} не найден")
                session["active"] = False
                self.save_state(user_id, session)
                break

            handler = self.block_handlers.get(block["Type"])
            if not handler:
                logger.error(f"process_blocks: нет обработчика для {block['Type']}")
                session["active"] = False
                self.save_state(user_id, session)
                break

            # вызов БЕЗ input (циклическая фаза)
            result = await handler(block, user_id, None)

            await self._process_block_result(user_id, result)

            # если блок ждёт ввода → прерваться
            if result == "wait":
                self.save_state(user_id, session)
                break

            # если break → остановить
            if result == "break":
                session = self.load_state(user_id)
                break

            session = self.load_state(user_id)

    async def _process_block_result(self, user_id: int, result: str):
        """
        Обработка результата ("continue", "wait", "break") после выполнения блока.
        """
        session = self.load_state(user_id)
        if not session:
            return

        if result == "continue":
            current_block = self.blocks.get(session["current_block"])
            out_conns = current_block["Connections"].get("Out", [])
            if out_conns:
                session["current_block"] = out_conns[0]
                session["step"] = 0
                self.save_state(user_id, session)
            else:
                # диалог завершён
                session["active"] = False
                self.save_state(user_id, session)

        elif result == "break":
            session["active"] = False
            self.save_state(user_id, session)

        # "wait" — ничего не делаем; предположено, что handler уже сохранил состояние

    # -------------------------
    # обработчики типов блоков
    # -------------------------
    async def _handle_start_block(self, block: Dict[str, Any], user_id: int, input_data: Optional[str]):
        return "continue"

    async def _handle_send_message_block(self, block: Dict[str, Any], user_id: int, input_data: Optional[str]):
        session = self.load_state(user_id)
        message_text = block["Params"]["message"]
        formatted = self._format_message(message_text, session["variables"])
        await self.api.send_message(user_id, formatted)
        return "continue"

    async def _handle_get_message_block(self, block: Dict[str, Any], user_id: int, input_data: Optional[str]):
        """
        Обработка блока getMessage с поддержкой типов:
        string, int, float, boolean
        """
        session = self.load_state(user_id)
        if not session:
            return "break"

        var_name = block["Params"]["var"]
        expected_type = block["Params"].get("type", "string")

        # Шаг 0: отправка промпта пользователю
        if session["step"] == 0:
            prompt = block["Params"]["message"]
            formatted_prompt = self._format_message(prompt, session["variables"])
            await self.api.send_message(user_id, formatted_prompt)

            session["step"] = 1  # ожидаем ввод
            self.save_state(user_id, session)
            return "wait"

        # Шаг 1: обработка пришедшего input_data
        if session["step"] == 1 and input_data is not None:
            value = input_data

            # Попытка преобразовать к нужному типу
            try:
                if expected_type == "string":
                    value = str(value)
                elif expected_type == "int":
                    value = int(value)
                elif expected_type in ("float", "double"):
                    value = float(value)
                elif expected_type == "boolean":
                    # для boolean принимаем 'true', 'false' (регистронезависимо)
                    if str(value).lower() in ("true", "1", "yes"):
                        value = True
                    elif str(value).lower() in ("false", "0", "no"):
                        value = False
                    else:
                        raise ValueError(f"Невозможно преобразовать {value} в boolean")
                else:
                    # неизвестный тип — оставляем как строку
                    value = str(value)

            except Exception:
                # Ошибка преобразования — сообщаем пользователю и возвращаемся к этому же блоку
                await self.api.send_message(user_id, f"Ошибка: введённое значение должно быть типа {expected_type}. Попробуйте ещё раз.")
                session["step"] = 0  # повторяем ввод
                self.save_state(user_id, session)
                return "wait"

            # Успешное преобразование — сохраняем и продолжаем
            session["variables"][var_name] = value
            session["step"] = 0
            self.save_state(user_id, session)
            return "continue"

        return "wait"


    async def _handle_choice_block(self, block: Dict[str, Any], user_id: int, input_data: Optional[str]):
        """
        choice: блокирующая реализация.
        При step==0: сохранить step=1, вызвать api.get_choice (await) — ждём нажатия.
        После получения — сохранить переменную и перейти по соответствующему выходу.
        """
        session = self.load_state(user_id)

        if session["step"] == 0:
            prompt = self._format_message(block["Params"]["prompt"], session["variables"])
            options = block["Params"]["options"]
            choices = [{"text": opt["label"], "value": opt["id"]} for opt in options]

            # Ставим сессию в ожидание (на будущее, если нужно восстановление)
            session["step"] = 1
            self.save_state(user_id, session)

            selected_id = await self.api.get_choice(user_id=user_id, text=prompt, choices=choices)
            # После await выполнится переход ниже

            # Обработаем выбранный id
            input_data = selected_id

        if session["step"] == 1 and input_data is not None:
            options = block["Params"]["options"]
            selected_option = next((o for o in options if o["id"] == input_data), None)
            if not selected_option:
                # некорректный выбор — заканчиваем диалог
                logger.error(f"Выбран несуществующий вариант {input_data} для пользователя {user_id}")
                session["step"] = 0
                self.save_state(user_id, session)
                return "break"

            # сохраняем значение переменной
            var_name = block["Params"]["var"]
            session["variables"][var_name] = selected_option["value"]

            # вычисляем индекс опции и переходим по соответствующему Out
            idx = options.index(selected_option)
            out_conns = block["Connections"].get("Out", [])
            if idx < len(out_conns):
                session["current_block"] = out_conns[idx]

            session["step"] = 0
            self.save_state(user_id, session)
            return "continue"

        return "wait"

    async def _handle_condition_block(self, block: Dict[str, Any], user_id: int, input_data: Optional[str] = None) -> str:
        """
        Блок ветвления: вычисляет условие на основе переменных.
        Переход к 'Yes' или 'No' ветке.
        """
        session = self.load_state(user_id)
        if not session:
            return "break"

        # Предполагается, что блок содержит поле 'condition' — строку, которую можно eval
        condition_expr = block["Params"].get("condition", "False")

        # Форматируем переменные в локальном namespace для eval
        variables = session["variables"]
        try:
            result = eval(condition_expr, {}, variables)
        except Exception as e:
            logger.error(f"Ошибка вычисления условия для пользователя {user_id}: {e}")
            result = False

        # Выбор ветви
        out_conns = block["Connections"].get("Out", [])
        if result and len(out_conns) >= 1:
            session["current_block"] = out_conns[0]  # 'Да'
        elif not result and len(out_conns) >= 2:
            session["current_block"] = out_conns[1]  # 'Нет'
        else:
            logger.warning(f"Блок ветвления {block['Block_id']} для {user_id} не имеет нужной ветви")
            session["active"] = False
            self.save_state(user_id, session)
            return "break"

        self.save_state(user_id, session)
        return "continue"

    import aiohttp

    async def _handle_api_request_block(self, block: Dict[str, Any], user_id: int, input_data: Optional[str] = None) -> str:
        """
        Блок запроса к API: выполняет HTTP-запрос, сохраняет результат в переменные.
        Переход к Success/Fail блокам.
        """
        session = self.load_state(user_id)
        if not session:
            return "break"

        params = block["Params"]
        url = params.get("url")
        method = params.get("method", "GET").upper()
        headers = params.get("headers", {})
        body = params.get("body", None)
        var_mapping = params.get("variables", {})  # {"json_field": "var_name"}

        if not url:
            logger.error(f"API block {block['Block_id']} без URL")
            session["active"] = False
            self.save_state(user_id, session)
            return "break"

        try:
            async with aiohttp.ClientSession() as client:
                if method == "GET":
                    async with client.get(url, headers=headers) as resp:
                        status = resp.status
                        data = await resp.json()
                else:
                    async with client.request(method, url, json=body, headers=headers) as resp:
                        status = resp.status
                        data = await resp.json()

            if 200 <= status < 300:
                # сохраняем переменные
                for field, var_name in var_mapping.items():
                    if field in data:
                        session["variables"][var_name] = data[field]
                # переход к ветке Success
                out_conns = block["Connections"].get("Out", [])
                if len(out_conns) >= 1:
                    session["current_block"] = out_conns[0]
                self.save_state(user_id, session)
                return "continue"
            else:
                # переход к ветке Fail / Default
                out_conns = block["Connections"].get("Out", [])
                if len(out_conns) >= 2:
                    session["current_block"] = out_conns[1]
                self.save_state(user_id, session)
                return "continue"

        except Exception as e:
            logger.error(f"API request error for user {user_id}: {e}")
            session["active"] = False
            self.save_state(user_id, session)
            return "break"


    async def _handle_final_block(self, block: Dict[str, Any], user_id: int, input_data: Optional[str]):
        session = self.load_state(user_id)
        final_msg = "Диалог завершён. Собранные данные:\n"
        for k, v in session["variables"].items():
            if k not in ("username", "first_name", "user_id"):
                final_msg += f"{k}: {v}\n"
        await self.api.send_message(user_id, final_msg)
        return "break"

    # -------------------------
    # utility
    # -------------------------
    def _format_message(self, text: str, variables: Dict[str, Any]) -> str:
        for key, value in variables.items():
            placeholder = "${" + key + "}"
            text = text.replace(placeholder, str(value))
        return text

    def create_session(self, user_id: int):
        """Создать новую сессию как раньше в aiogram-версии."""
        initial_vars = {}

        for var in self.model.get("GlobalVariables", []):
            initial_vars[var["name"]] = var.get("default", "")

        # базовые данные о пользователе
        initial_vars.update({
            "user_id": user_id,
            "username": "",
            "first_name": "",
        })

        session = {
            "current_block": self.model["Start"],
            "variables": initial_vars,
            "step": 0,
            "active": True,
        }

        self.save_state(user_id, session)
        return session

    async def start_new_session(self, user_id: int):
        """Создаёт новую сессию или перезапускает существующую"""
        session = self.sessions.get(user_id)
        if session:
            # перезапускаем существующую сессию
            session.update({
                "current_block": self.model["Start"],
                "step": 0,
                "active": True
            })
        else:
            # создаём новую
            initial_vars = {var["name"]: var.get("default", "")
                            for var in self.model.get("GlobalVariables", [])}
            initial_vars.update({
                "user_id": user_id,
            })
            self.sessions[user_id] = {
                "current_block": self.model["Start"],
                "variables": initial_vars,
                "step": 0,
                "active": True
            }
        return self.sessions[user_id]
        