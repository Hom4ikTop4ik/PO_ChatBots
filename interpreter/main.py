# main.py
import asyncio
import json
import logging
from pathlib import Path

# Импортируем валидатор (предполагаем, что он у вас есть)
from validator import parse_bot_config_from_file, ValidationError

# Импортируем наши классы
from bot_interpreter import BotInterpreter
from api_tg import TelegramAPI
# Импортируем хранилище (важно для явности)
from state_storage import MemoryStorage 

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def load_json_file(path: str):
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Файл не найден: {path}")
    return json.loads(p.read_text(encoding="utf-8"))


async def main_async():
    # Загрузить bot-model и bot-config
    bot_model_path = "bot_model.json"
    bot_config_path = "bot_config.json"

    # 1. Загрузка модели
    try:
        # Если validator.py нет, можно временно использовать load_json_file
        bot_model = parse_bot_config_from_file(bot_model_path)
        logger.info("Бот-модель загружена и валидирована.")
    except Exception as e:
        logger.error(f"Ошибка загрузки бот-модели: {e}")
        return

    # 2. Загрузка конфига
    try:
        cfg = load_json_file(bot_config_path)
    except Exception as e:
        logger.error(f"Ошибка загрузки конфига: {e}")
        return

    # Берём токен из bot-config
    token = cfg.get("Token")
    if not token or token == "TOKEN":
        logger.error("Не задан токен Telegram")
        return

    # 3. Инициализация API
    # ВАЖНО: Передаем interpreter=None, так как он еще не создан
    platform_name = cfg.get("platform-name", "telegram").lower()
    
    if platform_name == "telegram":
        api = TelegramAPI(token=token, interpreter=None)
    else:
        logger.error(f"Неподдерживаемая платформа: {platform_name}")
        return

    # 4. Инициализация Хранилища
    # Создаем хранилище здесь, чтобы потом легко заменить MemoryStorage на RedisStorage
    storage = MemoryStorage()

    # 5. Инициализация Интерпретатора
    # Связываем его с API и Хранилищем
    interpreter = BotInterpreter(bot_model=bot_model, api=api, storage=storage)

    # 6. Замыкаем круг зависимостей
    # Теперь сообщаем API, кто его интерпретатор
    api.set_interpreter(interpreter)

    # 7. Запуск
    logger.info("Запуск бота...")
    await api.run()


if __name__ == "__main__":
    try:
        if hasattr(asyncio, "run"):
            asyncio.run(main_async())
        else:
            # Для старых версий Python (если вдруг < 3.7)
            loop = asyncio.get_event_loop()
            loop.run_until_complete(main_async())
    except KeyboardInterrupt:
        logger.info("Бот остановлен пользователем.")
    except Exception as e:
        logger.critical(f"Критическая ошибка: {e}", exc_info=True)
