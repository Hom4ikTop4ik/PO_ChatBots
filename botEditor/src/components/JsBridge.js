// JSBridge.js

export class PreviewJSBridge {
  constructor(setMessages, setWaitingForInput, setPendingInput, setChoiceOptions) {
    this.setMessages = setMessages;
    this.setWaitingForInput = setWaitingForInput;
    this.setPendingInput = setPendingInput;
    this.setChoiceOptions = setChoiceOptions;
    this.inputResolve = null;
    this.choiceResolve = null;
  }

  async add_message(text, is_bot = true) {
      console.log("smth");
      this.setMessages(prev => [...prev, { from: is_bot ? "bot" : "user", text }]);
      console.log("ABOBA");
      return 1;
  }

  // Python сам вызовет add_message(prompt) перед get_user_input
  async get_user_input(varName = null, next = null) {
    this.setPendingInput({ varName, next });
    this.setWaitingForInput(true);
    return new Promise(resolve => {
      this.inputResolve = resolve;
    });
  }

  async get_user_choice(options) {
    this.setChoiceOptions(options);
    this.setWaitingForInput(true);
    return new Promise(resolve => {
      this.choiceResolve = resolve;
    });
  }

  provideInput(text) {
    if (this.inputResolve) {
      this.inputResolve(text);
      this.inputResolve = null;
    }
    this.setWaitingForInput(false);
    this.setPendingInput(null);
  }

  provideChoice(choiceId) {
    if (this.choiceResolve) {
      this.choiceResolve(choiceId);
      this.choiceResolve = null;
    }
    this.setWaitingForInput(false);
    this.setChoiceOptions([]);
  }
}
