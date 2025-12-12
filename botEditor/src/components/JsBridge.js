// JsBridge.js

export class PreviewJSBridge {
  constructor(setMessages, setWaitingForInput, setChoiceOptions) {
    // Сеттеры для управления UI
    this.setMessages = setMessages;
    this.setWaitingForInput = setWaitingForInput;
    this.setChoiceOptions = setChoiceOptions;

    // Ссылки на Python-функции (будут установлены из main_preview.py)
    this.pyCallbackText = null;
    this.pyCallbackChoice = null;
  }

  // ==========================================
  // PYTHON -> JS (Вывод данных в UI)
  // ==========================================

  async add_message(text, is_bot = true) {
    this.setMessages((prev) => [
      ...prev,
      { from: is_bot ? "bot" : "user", text },
    ]);
  }

  async activate_input_mode() {
    this.setWaitingForInput(true);
  }

  async show_choices(text, choices) {
    await this.add_message(text, true);
    const options =
      choices && typeof choices.toJs === "function" ? choices.toJs() : choices;
    this.setChoiceOptions(options);
    this.setWaitingForInput(true);
  }
  async show_choices(text, choices) {
    await this.add_message(text, true);

    // Мы передаем { dict_converter: Object.fromEntries }
    // Это заставляет Pyodide превращать Python dict в JS Object, а не Map.
    const options = choices && typeof choices.toJs === "function" 
        ? choices.toJs({ dict_converter: Object.fromEntries }) 
        : choices;

    console.log("[JSBridge] Received options:", options); // Для отладки
    this.setChoiceOptions(options);
    this.setWaitingForInput(true);
  }

  // ==========================================
  // ИНИЦИАЛИЗАЦИЯ (Вызывается из Python)
  // ==========================================

  /**
   * Python передает сюда свои функции, чтобы мы могли их вызывать.
   * @param {Function} onText - функция python для приема текста
   * @param {Function} onChoice - функция python для приема выбора кнопки
   */
  bindPythonCallbacks(onText, onChoice) {
    this.pyCallbackText = onText;
    this.pyCallbackChoice = onChoice;
    console.log("[JSBridge] Callbacks bound successfully");
  }

  // ==========================================
  // JS (REACT) -> PYTHON (Отправка данных)
  // ==========================================

  /**
   * Вызывается из React, когда юзер ввел текст и нажал Enter
   */
  async sendUserText(text) {
    // Сначала обновляем UI, чтобы не ждать Python
    await this.add_message(text, false);
    
    // Передаем данные в Python
    if (this.pyCallbackText) {
      try {
        await this.pyCallbackText(text);
      } catch (err) {
        console.error("[JSBridge] Error calling Python text handler:", err);
      }
    } else {
      console.warn("[JSBridge] Python handlers not bound yet");
    }
  }

  /**
   * Вызывается из React, когда юзер нажал кнопку
   */
  async sendUserChoice(option) {
    // Обновляем UI
    await this.add_message(option.label, false);
    
    // Убираем кнопки
    this.setChoiceOptions([]);
    
    // Блокируем ввод сразу после клика
    this.setWaitingForInput(false);

    // Передаем ID в Python
    if (this.pyCallbackChoice) {
      try {
        await this.pyCallbackChoice(option.id);
      } catch (err) {
        console.error("[JSBridge] Error calling Python choice handler:", err);
      }
    }
  }
}
