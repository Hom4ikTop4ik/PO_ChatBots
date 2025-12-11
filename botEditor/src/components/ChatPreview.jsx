import { useState, useEffect, useRef } from "react";
import { toScenario } from "../utils/scenarioUtils";
import { PreviewJSBridge } from "./JsBridge";


// TODO: вынести html в отдельные компоненты
export default function ChatPreview({ nodes, edges, globalVariables }) {
  const [open, setOpen] = useState(false);

  const [inputValue, setInputValue] = useState("");

  const [messages, setMessages] = useState([]);
  const [waitingForInput, setWaitingForInput] = useState(false);
  const [pendingInput, setPendingInput] = useState(null);
  const [choiceOptions, setChoiceOptions] = useState([]);

  const pyodideRef = useRef(null);
  const [pyodide, setPyodide] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const jsBridgeRef = useRef(null);

  useEffect(() => {
    console.log("waitingForInput:", waitingForInput);
  }, [waitingForInput]);

  // 1️⃣ Первый useEffect — загрузка Pyodide и Python‑файлов
  useEffect(() => {
    async function loadPyodideOnce() {
      try {
        if (window.pyodidePromise) {
          const pyodideInstance = await window.pyodidePromise;
          setPyodide(pyodideInstance);
          pyodideRef.current = pyodideInstance;
          return;
        }

        setLoading(true);

        // Загружаем Pyodide
        window.pyodidePromise = (async () => {
          const { loadPyodide } = await import("pyodide");
          return await loadPyodide({
            indexURL: "https://cdn.jsdelivr.net/pyodide/v0.29.0/full/",
            stdout: (text) => console.log("[Python]", text),
            stderr: (text) => console.error("[Python Error]", text),
          });
        })();

        const pyodideInstance = await window.pyodidePromise;
        setPyodide(pyodideInstance);
        pyodideRef.current = pyodideInstance;

        // Подключаем micropip и pyodide-http
        await pyodideInstance.loadPackage(["micropip"]);
        const micropip = pyodideInstance.pyimport("micropip");
        await micropip.install(["aiohttp", "pyodide-http"]);

        pyodideInstance.runPython(`
          import pyodide_http
          pyodide_http.patch_all()
        `);

        // Загружаем Python‑файлы
        const [apiResponse, interpreterResponse, mainResponse] = await Promise.all([
          fetch("/python/api_preview.py"),
          fetch("/python/bot_interpreter.py"),
          fetch("/python/main_preview.py"),
        ]);

        if (!apiResponse.ok || !interpreterResponse.ok || !mainResponse.ok) {
          throw new Error("Python файлы не найдены");
        }

        const [apiPreviewCode, botInterpreterCode, mainPreviewCode] =
          await Promise.all([
            apiResponse.text(),
            interpreterResponse.text(),
            mainResponse.text(),
          ]);

        // Записываем файлы в виртуальную FS
        const FS = pyodideInstance.FS;
        FS.mkdir("/python");
        FS.writeFile("/python/__init__.py", "");
        FS.writeFile("/python/api_preview.py", apiPreviewCode);
        FS.writeFile("/python/bot_interpreter.py", botInterpreterCode);
        FS.writeFile("/python/main_preview.py", mainPreviewCode);

        // Передаём JS‑мост
        pyodideInstance.globals.set("js_bridge", jsBridgeRef.current);

        // Инициализация модулей
        pyodideInstance.runPython(`
  import sys
  sys.path.append('/python')
  from main_preview import init_preview, start_preview
  init_preview(js_bridge)
        `);

        setError(null);
      } catch (err) {
        console.error("Failed to load Pyodide:", err);
        setError("Не удалось загрузить Python интерпретатор или файлы.");
      } finally {
        setLoading(false);
      }
    }

    loadPyodideOnce();
  }, []);

  // инициализируем ~~любимку~~ JS bridge
  useEffect(() => {
    jsBridgeRef.current = new PreviewJSBridge(
      setMessages,
      setWaitingForInput,
      setPendingInput,
      setChoiceOptions
    );
  }, []);

  // 2️⃣ Второй useEffect — запуск превью при открытии окна
  // ВРОДЕ при открытии всё заново, не храним состояние между открытиями
  useEffect(() => {
    async function maybeStart() {
      if (open && pyodideRef.current) {
        const botModel = toScenario(nodes, edges);
        resetChatState();
        await pyodideRef.current.runPythonAsync(`
          start_preview(${JSON.stringify(JSON.stringify(botModel))})
        `);
      }
    }
    maybeStart();
  }, [open, pyodide]);

  function resetChatState() {
    setMessages([]);
    setChoiceOptions([]);
    setWaitingForInput(false);
    setPendingInput(null);
  }

  const handleUserInput = () => {
    if (!inputValue.trim()) return;
    
    const val = inputValue;
    setMessages(prev => [...prev, { from: "user", text: val }]);
    jsBridgeRef.current.provideInput(val);

    setInputValue("");
  };

  const handleChoiceSelect = (opt) => {
    setMessages(prev => [...prev, { from: "user", text: opt.label }]);
    jsBridgeRef.current.provideChoice(opt.id);
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
