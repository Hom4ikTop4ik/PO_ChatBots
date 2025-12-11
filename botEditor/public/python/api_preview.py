# api_preview.py

class PreviewAPI:
    def __init__(self, js_bridge):
        self.js_bridge = js_bridge
    
    async def send_message(self, user_id, text):
        # Добавляем сообщение от бота в UI
        print("pupupu")
        a = await self.js_bridge.add_message(text, is_bot=True)
        print("send", a)

    
    async def get_message(self, user_id, prompt=None, var_name=None):
        # Отправляем подсказку пользователю
        if prompt:
            await self.send_message(user_id, prompt)
        # Ждём, пока пользователь введёт текст
        print("get")
        return await self.js_bridge.get_user_input()
    
    async def get_choice(self, user_id, prompt, choices):
        # Отправляем текст‑подсказку
        await self.send_message(user_id, prompt)
        # Ждём выбор пользователя
        print("choice")
        return await self.js_bridge.get_user_choice(choices)
