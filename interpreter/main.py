# main.py
import asyncio
import json
import logging
from pathlib import Path

from validator import parse_bot_config_from_file, ValidationError

from bot_interpreter import BotInterpreter
from API_tg import TelegramAPI

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def load_json_file(path: str):
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(path)
    return json.loads(p.read_text(encoding="utf-8"))


async def main_async():
    # Загрузить bot-model и bot-config
    bot_model_path = "bot_model.json"
    bot_config_path = "bot_config.json"

    try:
        bot_model = parse_bot_config_from_file(bot_model_path)
        logger.info("Бот-модель загружена и валидирована.")
    except ValidationError as e:
        logger.error(f"Ошибка валидации бот-модели: {e}")
        return
    except Exception as e:
        logger.error(f"Ошибка загрузки бот-модели: {e}")
        return

    try:
        cfg = load_json_file(bot_config_path)
    except Exception as e:
        logger.error(f"Ошибка загрузки {bot_config_path}.json: {e}")
        return

    # Берём токен из bot-model (можно использовать и из bot-config)
    token = cfg.get("Token")
    if not token or token == "TOKEN":
        logger.error(f"Не задан токен Telegram в {bot_config_path}")
        return

    platform_name = cfg.get("platform-name", "telegram").lower()
    
    if platform_name == "telegram":
        api = TelegramAPI(token=token)
    else:
        logger.error(f"Неподдерживаемая платформа: {platform_name}")
        return
    # Создать объекты
    interpreter = BotInterpreter(bot_model=bot_model, api=api)

    # установить ссылку интерпретатора в api
    api.set_interpreter(interpreter)

    # Запустить polling (блокирует)
    await api.run()


if __name__ == "__main__":
    try:
        asyncio.run(main_async())
    except KeyboardInterrupt:
        logger.info("Остановка сервиса.")
