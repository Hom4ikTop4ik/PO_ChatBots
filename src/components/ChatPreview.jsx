import { useState, useEffect } from "react";
import { toScenario } from "../utils/scenarioUtils";

// TODO: добавить проверку типов
// TODO: вынести html в отдельные компоненты
// TODO: добавить обработку api блока
// TODO: добавить поддержку разных типов переменных (числа, булевы и т.д.)
// TODO: улучшить безопасность evaluateExpression и исправить работу блока условия для строк
export default function ChatPreview({ nodes, edges, globalVariables }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [currentBlockId, setCurrentBlockId] = useState(null);
  const [waitingForInput, setWaitingForInput] = useState(false);
  const [pendingInput, setPendingInput] = useState(null);
  const [choiceOptions, setChoiceOptions] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [variables, setVariables] = useState({});

  useEffect(() => {
    const initVars = {};
    (globalVariables || []).forEach((v) => {
      initVars[v] = "";
    });
    setVariables(initVars);
  }, [globalVariables, open]);

  useEffect(() => {
    if (open) {
      startChat();
    }
  }, [open]);

  useEffect(() => {
    if (!open || waitingForInput || !currentBlockId) return;
    const scenario = toScenario(nodes, edges);
    const blockMap = {};
    scenario.Blocks.forEach((b) => {
      blockMap[b.Block_id] = b;
    });
    const block = blockMap[currentBlockId];
    if (!block) return;
    const type = block.Type;
    switch (type) {
      case "start": {
        const next = block.Connections.Out && block.Connections.Out[0];
        setCurrentBlockId(next || null);
        break;
      }
      case "sendMessage": {
        const text = replaceVars(block.Params?.message || "");
        addBotMessage(text);
        const next = block.Connections.Out && block.Connections.Out[0];
        setTimeout(() => setCurrentBlockId(next || null), 300);
        break;
      }
      case "getMessage": {
        const prompt = replaceVars(block.Params?.message || "");
        addBotMessage(prompt);
        setPendingInput({
          varName: block.Params?.var || "",
          next: block.Connections.Out && block.Connections.Out[0],
        });
        setWaitingForInput(true);
        break;
      }
      case "condition": {
        const expr = block.Params?.expression || "";
        const result = evaluateExpression(expr);
        const index = result ? 0 : 1;
        const next = block.Connections.Out && block.Connections.Out[index];
        setTimeout(() => setCurrentBlockId(next || null), 100);
        break;
      }
      case "choice": {
        const prompt = replaceVars(block.Params?.prompt || "");
        const options = block.Params?.options || [];
        addBotMessage(prompt);
        const outs = block.Connections.Out || [];
        const optsWithNext = options.map((opt, idx) => ({
          ...opt,
          next: outs[idx],
        }));
        setChoiceOptions(optsWithNext);
        setWaitingForInput(true);
        break;
      }
      case "api": {
        const varName = block.Params?.resultVariable;
        if (varName) {
          setVariables((vars) => ({ ...vars, [varName]: "" }));
        }
        const next = block.Connections.Out && block.Connections.Out[0];
        setTimeout(() => setCurrentBlockId(next || null), 100);
        break;
      }
      case "final": {
        addBotMessage("Диалог завершен.");
        setCurrentBlockId(null);
        break;
      }
      default:
        setCurrentBlockId(null);
        break;
    }
  }, [open, currentBlockId, waitingForInput]);

  const startChat = () => {
    setMessages([]);
    setChoiceOptions([]);
    setWaitingForInput(false);
    setPendingInput(null);
    const scenario = toScenario(nodes, edges);
    const startId = scenario.Start || nodes.find((n) => n.type === "start")?.id;
    if (!startId) {
      setMessages([
        { from: "bot", text: "Сценарий не имеет стартового блока" },
      ]);
      setCurrentBlockId(null);
    } else {
      setCurrentBlockId(startId);
    }
  };

  const replaceVars = (text) => {
    return text.replace(/\$\{([^}]+)\}/g, (_, v) => {
      return variables[v] !== undefined ? variables[v] : "";
    });
  };

  const addBotMessage = (text) => {
    setMessages((msgs) => [...msgs, { from: "bot", text }]);
  };

  const evaluateExpression = (expr) => {
    try {
      const replaced = expr.replace(
        /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g,
        (match) => {
          if (Object.prototype.hasOwnProperty.call(variables, match)) {
            const val = variables[match];
            if (val === true || val === "true") return "true";
            if (val === false || val === "false") return "false";
            if (!isNaN(val)) return val;
            return `'${val}'`;
          }
          return match;
        }
      );
      const fn = Function(`return (${replaced})`);
      return !!fn();
    } catch (e) {
      return false;
    }
  };

  const handleUserInput = () => {
    if (!inputValue.trim()) return;
    const val = inputValue;
    setMessages((msgs) => [...msgs, { from: "user", text: val }]);
    const { varName, next } = pendingInput || {};
    if (varName) {
      setVariables((vars) => ({ ...vars, [varName]: val }));
    }
    setInputValue("");
    setWaitingForInput(false);
    setPendingInput(null);
    setChoiceOptions([]);
    setCurrentBlockId(next || null);
  };

  const handleChoiceSelect = (opt) => {
    setMessages((msgs) => [...msgs, { from: "user", text: opt.label }]);
    setWaitingForInput(false);
    setChoiceOptions([]);
    setPendingInput(null);
    setCurrentBlockId(opt.next || null);
  };

  return (
    <div>
      <div
        style={{
          position: "fixed",
          left: 20,
          bottom: 20,
          width: 48,
          height: 48,
          borderRadius: "50%",
          background: "#1976d2",
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          zIndex: 1000,
        }}
        onClick={() => setOpen((o) => !o)}
        title="Превью чат"
      >
        💬
      </div>
      {open && (
        <div
          style={{
            position: "fixed",
            left: 80,
            bottom: 20,
            width: 320,
            height: 380,
            background: "white",
            border: "1px solid #ccc",
            borderRadius: 8,
            boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
            display: "flex",
            flexDirection: "column",
            zIndex: 999,
          }}
        >
          <div
            style={{
              padding: 8,
              borderBottom: "1px solid #eee",
              fontWeight: 600,
              background: "#f5f5f5",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            Превью чат
            <button
              onClick={() => setOpen(false)}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
            {messages.map((msg, idx) => (
              <div
                key={idx}
                style={{
                  marginBottom: 8,
                  textAlign: msg.from === "bot" ? "left" : "right",
                }}
              >
                <div
                  style={{
                    display: "inline-block",
                    padding: "6px 10px",
                    borderRadius: 6,
                    background: msg.from === "bot" ? "#e3f2fd" : "#c8e6c9",
                    maxWidth: "80%",
                    wordBreak: "break-word",
                  }}
                >
                  {msg.text}
                </div>
              </div>
            ))}
          </div>
          <div style={{ padding: 8, borderTop: "1px solid #eee" }}>
            {choiceOptions.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {choiceOptions.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => handleChoiceSelect(opt)}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: "1px solid #ccc",
                      background: "#f5f5f5",
                      cursor: "pointer",
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            ) : waitingForInput ? (
              <div style={{ display: "flex" }}>
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  style={{
                    flex: 1,
                    padding: 6,
                    border: "1px solid #ccc",
                    borderRadius: 4,
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleUserInput();
                  }}
                />
                <button
                  onClick={handleUserInput}
                  style={{
                    marginLeft: 4,
                    padding: "6px 12px",
                    borderRadius: 4,
                    border: "none",
                    background: "#1976d2",
                    color: "white",
                    cursor: "pointer",
                  }}
                >
                  ➤
                </button>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#888" }}>
                Бот генерирует ответ...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
