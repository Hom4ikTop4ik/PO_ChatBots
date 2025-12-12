import React, { useState, useEffect, useRef } from "react";
// Утилита для конвертации графа узлов в JSON-сценарий
import { toScenario } from "../utils/scenarioUtils";
// Импорт обновленного класса моста
import { PreviewJSBridge } from "./JsBridge";

export default function ChatPreview({ nodes, edges, open: propOpen }) {
  // --- Состояние открытия окна ---
  const [isOpen, setIsOpen] = useState(false);

  // Синхронизация с пропом (если управление снаружи)
  useEffect(() => {
    if (propOpen !== undefined) setIsOpen(propOpen);
  }, [propOpen]);

  // --- Состояния UI ---
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [waitingForInput, setWaitingForInput] = useState(false);
  const [choiceOptions, setChoiceOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // --- Refs ---
  const pyodideRef = useRef(null);
  const jsBridgeRef = useRef(null);
  const messagesEndRef = useRef(null);

  // 1️⃣ Инициализация JSBridge (СИНХРОННО)
  if (!jsBridgeRef.current) {
    jsBridgeRef.current = new PreviewJSBridge(
      setMessages,
      setWaitingForInput,
      setChoiceOptions
    );
  }

  // 2️⃣ Авто-скролл
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, choiceOptions, isOpen]);

  // 3️⃣ Загрузка Pyodide и Python-файлов
  useEffect(() => {
    if (!isOpen) return;

    async function initPyodide() {
      if (pyodideRef.current) return;

      try {
        setLoading(true);

        // A. Загрузка движка
        if (!window.loadPyodide) {
           const script = document.createElement('script');
           script.src = "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js";
           document.body.appendChild(script);
           await new Promise(resolve => script.onload = resolve);
        }

        const pyodide = await window.loadPyodide({
          indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/",
          stdout: (text) => console.log("[Py]:", text),
          stderr: (text) => console.error("[Py Err]:", text),
        });

        // B. Установка зависимостей
        await pyodide.loadPackage("micropip");
        const micropip = pyodide.pyimport("micropip");
        await micropip.install(["pyodide-http", "aiohttp"]);

        pyodide.runPython(`
          import pyodide_http
          pyodide_http.patch_all()
        `);

        // C. Загрузка файлов
        const fileNames = [
          "bot_api_interface.py",
          "state_storage.py",
          "api_preview.py",
          "bot_interpreter.py",
          "main_preview.py"
        ];

        const FS = pyodide.FS;
        if (!FS.analyzePath("/python").exists) {
            FS.mkdir("/python");
        }

        await Promise.all(fileNames.map(async (name) => {
            // Добавляем timestamp для сброса кэша
            const response = await fetch(`/python/${name}?t=${Date.now()}`);
            if (!response.ok) throw new Error(`Failed to fetch ${name}`);
            const code = await response.text();
            FS.writeFile(`/python/${name}`, code);
        }));

        pyodide.runPython(`
          import sys
          if '/python' not in sys.path:
              sys.path.append('/python')
        `);

        // D. Передача моста
        pyodide.globals.set("js_bridge", jsBridgeRef.current);

        // E. Инициализация через pyimport (надежно)
        const mainModule = pyodide.pyimport("main_preview");
        mainModule.init_preview(jsBridgeRef.current);

        pyodideRef.current = pyodide;
        setLoading(false);
      } catch (err) {
        console.error("Pyodide Load Error:", err);
        setError("Ошибка инициализации Python: " + err.message);
        setLoading(false);
      }
    }

    initPyodide();
  }, [isOpen]);

  // 4️⃣ Перезапуск сценария
  useEffect(() => {
    async function restartScenario() {
      if (!isOpen || !pyodideRef.current || loading) return;

      // Сброс UI
      setMessages([]);
      setChoiceOptions([]);
      setInputValue("");
      setWaitingForInput(false);

      try {
        const botModel = toScenario(nodes, edges);
        const jsonModel = JSON.stringify(botModel);
        
        const mainModule = pyodideRef.current.pyimport("main_preview");
        await mainModule.start_preview(jsonModel);
        
      } catch (err) {
        console.error("Error starting scenario:", err);
        setMessages(prev => [...prev, { from: "bot", text: "Ошибка старта: " + err.message }]);
      }
    }

    restartScenario();
  }, [isOpen, nodes, edges, loading]);

  // --- Handlers ---

  const handleUserInput = async () => {
    if (!inputValue.trim()) return;
    const text = inputValue;
    
    setInputValue("");
    setWaitingForInput(false);

    if (jsBridgeRef.current) {
       await jsBridgeRef.current.sendUserText(text);
    }
  };

  const handleChoiceSelect = async (opt) => {
    if (jsBridgeRef.current) {
        await jsBridgeRef.current.sendUserChoice(opt);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && waitingForInput) {
      handleUserInput();
    }
  };

  // --- Render (ORIG UI) ---
 
  return (
    <div>
      {!isOpen && (
        <div
            style={{ position: "fixed", left: 20, bottom: 20, width: 56, height: 56, borderRadius: "50%", background: "#1976d2", color: "white", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 1000, boxShadow: "0 4px 12px rgba(0,0,0,0.3)", fontSize: "24px" }}
            onClick={() => setIsOpen(true)}
            title="Открыть превью"
        >
            💬
        </div>
      )}

      {isOpen && (
        <div style={{ position: "fixed", left: 20, bottom: 90, width: 360, height: 550, background: "white", border: "1px solid #e0e0e0", borderRadius: 16, boxShadow: "0 8px 30px rgba(0,0,0,0.15)", display: "flex", flexDirection: "column", zIndex: 999, overflow: "hidden", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
          
          <div style={{ padding: "16px", borderBottom: "1px solid #f0f0f0", fontWeight: 600, background: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "16px", color: "#333" }}>
            <span>Превью бота</span>
            <button onClick={() => setIsOpen(false)} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: "24px", color: "#999", lineHeight: 1 }}>×</button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 16, background: "#f9f9f9" }}>
            {loading && <div style={{textAlign: 'center', marginTop: 20, color: '#666', fontSize: 13}}>Загрузка Python окружения...</div>}
            {error && <div style={{textAlign: 'center', marginTop: 20, color: '#d32f2f', fontSize: 13}}>{error}</div>}
            {messages.length === 0 && !loading && !error && <div style={{textAlign: 'center', marginTop: 40, color: '#ccc', fontSize: 13}}>Диалог начнется автоматически...</div>}
            
            {messages.map((msg, idx) => (
              <div key={idx} style={{ marginBottom: 12, display: "flex", justifyContent: msg.from === "bot" ? "flex-start" : "flex-end" }}>
                <div style={{ padding: "10px 14px", borderRadius: 18, borderTopLeftRadius: msg.from === "bot" ? 4 : 18, borderTopRightRadius: msg.from === "bot" ? 18 : 4, background: msg.from === "bot" ? "#ffffff" : "#1976d2", color: msg.from === "bot" ? "#333" : "#fff", maxWidth: "80%", wordBreak: "break-word", fontSize: "14px", lineHeight: "1.4", boxShadow: msg.from === "bot" ? "0 1px 2px rgba(0,0,0,0.1)" : "none", border: msg.from === "bot" ? "1px solid #e0e0e0" : "none" }}>
                  {msg.text}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div style={{ padding: 12, borderTop: "1px solid #f0f0f0", background: "#fff" }}>
            {choiceOptions.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" }}>
                {choiceOptions.map((opt, idx) => {
                  // Fallback, если label вдруг нет
                  const label = opt.label || "Кнопка " + (idx + 1);
                  return (
                    <button
                        key={opt.id || idx} 
                        onClick={() => handleChoiceSelect(opt)}
                        style={{ padding: "8px 16px", borderRadius: 20, border: "1px solid #1976d2", background: "white", color: "#1976d2", cursor: "pointer", fontSize: "13px", fontWeight: 500, transition: "background 0.2s" }}
                        onMouseOver={(e) => e.target.style.background = "#e3f2fd"}
                        onMouseOut={(e) => e.target.style.background = "white"}
                    >
                        {label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={waitingForInput ? "Сообщение..." : ""}
                  disabled={!waitingForInput}
                  style={{ flex: 1, padding: "10px 14px", border: "1px solid #e0e0e0", borderRadius: 24, outline: "none", fontSize: "14px", background: waitingForInput ? "white" : "#f5f5f5" }}
                  onKeyDown={handleKeyDown}
                />
                <button
                  onClick={handleUserInput}
                  disabled={!waitingForInput || !inputValue.trim()}
                  style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: waitingForInput && inputValue.trim() ? "#1976d2" : "#e0e0e0", color: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.2s" }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
