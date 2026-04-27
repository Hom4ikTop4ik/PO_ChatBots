import React, {
  useCallback,
  useRef,
  useState,
  useEffect,
} from "react";
import {
  ReactFlowProvider,
  applyNodeChanges,
  applyEdgeChanges,
} from "reactflow";
import "reactflow/dist/style.css";

import "../../styles/App.css";
import "../../styles/index.css";

import { fromScenario, toScenario } from "../../utils/scenarioUtils";
import { validateScenario } from "../../utils/validation";

import ChatPreview from "../../components/ChatPreview";
import BotsManager from "../../components/BotsManager";
import Canvas from "../../components/Canvas";

import StartNode from "../../components/nodes/StartNode";
import FinalNode from "../../components/nodes/FinalNode";
import MessageNode from "../../components/nodes/MessageNode";
import InputNode from "../../components/nodes/InputNode";
import ConditionNode from "../../components/nodes/ConditionNode";
import ChoiceNode from "../../components/nodes/ChoiceNode";
import ApiNode from "../../components/nodes/ApiNode";

import MessageInspector from "../../components/inspectors/MessageInspector";
import InputInspector from "../../components/inspectors/InputInspector";
import ConditionInspector from "../../components/inspectors/ConditionInspector";
import ChoiceInspector from "../../components/inspectors/ChoiceInspector";
import ApiInspector from "../../components/inspectors/ApiInspector";
import DefaultInspector from "../../components/inspectors/DefaultInspector";

import { useAuth } from "../../auth/AuthContext";
import {
  fetchBotsApi,
  createBotApi,
  updateBotApi,
  deleteBotApi,
} from "../../api/botsApi";
import {
  applyOperation,
  createBlockDeleteOp,
  createBlockMoveOp,
  createBlockUpdateOp,
  createEdgeAddOp,
  createEdgeDeleteOp,
  createScenarioReplaceOp,
  createInverseOperation,
} from "./operations";

const nodeTypes = {
  start: StartNode,
  final: FinalNode,
  message: MessageNode,
  input: InputNode,
  condition: ConditionNode,
  choice: ChoiceNode,
  api: ApiNode,
};

const INITIAL_EDITOR_STATE = {
  nodes: [],
  edges: [],
};

export default function BotEditorShell() {
  const { user, logout } = useAuth();

  const [editorState, setEditorState] = useState(INITIAL_EDITOR_STATE);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [showInspectorModal, setShowInspectorModal] = useState(false);

  const [botName, setBotName] = useState("Bot");
  const [botToken, setBotToken] = useState("");
  const [globalVariables, setGlobalVariables] = useState("");
  const [showBotSettings, setShowBotSettings] = useState(false);

  const [editingEdgeId, setEditingEdgeId] = useState(null);

  const [view, setView] = useState("editor");
  const [bots, setBots] = useState([]);
  const [loadingBots, setLoadingBots] = useState(false);

  const [scenarioVersion, setScenarioVersion] = useState(0);
  const [operationLog, setOperationLog] = useState([]);

  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);

  const fileInputRef = useRef(null);
  const editorStateRef = useRef(INITIAL_EDITOR_STATE);
  const scenarioVersionRef = useRef(0);
  
  const dragStartPosRef = useRef({}); 

  const nodes = editorState.nodes;
  const edges = editorState.edges;

  useEffect(() => {
    editorStateRef.current = editorState;
  }, [editorState]);

  useEffect(() => {
    scenarioVersionRef.current = scenarioVersion;
  }, [scenarioVersion]);

  useEffect(() => {
    window.__BOT_EDITOR_DEBUG__ = {
      get editorState() {
        return editorStateRef.current;
      },
      get scenarioVersion() {
        return scenarioVersionRef.current;
      },
      get operationLog() {
        return operationLog;
      },
    };
  }, [operationLog]);



  const getCurrentVersion = useCallback(() => scenarioVersionRef.current, []);

  const resetOperationState = useCallback(() => {
    setScenarioVersion(0);
    setOperationLog([]);
    scenarioVersionRef.current = 0;
  }, []);

  const replaceEditorState = useCallback(
    (nextState, { resetHistory = false } = {}) => {
      setEditorState(nextState);
      editorStateRef.current = nextState;

      if (resetHistory) {
        resetOperationState();
      }
    },
    [resetOperationState]
  );

  const dispatchOperation = useCallback((operation, isHistoryAction = false) => {
    if (!operation) return;

    const currentState = editorStateRef.current;
    let inverseOp = null;
    if (!isHistoryAction) {
      inverseOp = createInverseOperation(currentState, operation);
    }
    
    setEditorState((prev) => {
      const next = applyOperation(prev, operation);
      editorStateRef.current = next;
      return next;
    });

    setScenarioVersion((prev) => {
      const next = prev + 1;
      scenarioVersionRef.current = next;
      return next;
    });

    setOperationLog((prev) => {
      const entry = {
        ...operation,
        applied_version: scenarioVersionRef.current + 1,
      };
      const next = [...prev, entry];
      return next.slice(-200);
    });

    if (!isHistoryAction && inverseOp) {
      setUndoStack((prev) => [...prev, { original: operation, inverse: inverseOp }]);
      setRedoStack([]);
    }
  }, []);

  const handleUndo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev; // Нечего отменять
      
      const last = prev[prev.length - 1]; // Берём последнее действие
      const newUndo = prev.slice(0, -1);
      
      // Применяем обратную операцию (isHistoryAction = true)
      dispatchOperation(last.inverse, true);
      
      // Перекладываем в стек Redo, чтобы можно было вернуть обратно
      setRedoStack((r) => [...r, last]);
      return newUndo;
    });
  }, [dispatchOperation]);

  const handleRedo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev; // Нечего повторять
      
      const last = prev[prev.length - 1];
      const newRedo = prev.slice(0, -1);
      
      // Снова применяем оригинальную операцию
      dispatchOperation(last.original, true);
      
      // И возвращаем возможность её отменить
      setUndoStack((u) => [...u, last]);
      return newRedo;
    });
  }, [dispatchOperation]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      const isInput = e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA";
      if (isInput) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  const onConnect = useCallback(
    (params) => {
      dispatchOperation(createEdgeAddOp(params, getCurrentVersion()));
    },
    [dispatchOperation, getCurrentVersion]
  );

  const onNodesChange = useCallback(
    (changes) => {
      const nonRemoveChanges = changes.filter((change) => change.type !== "remove");
      if (nonRemoveChanges.length === 0) return;

      nonRemoveChanges.forEach((change) => {
        if (change.type === "position" && change.dragging) {
          if (!dragStartPosRef.current[change.id]) {
            const node = editorStateRef.current.nodes.find((n) => n.id === change.id);
            if (node) {
              dragStartPosRef.current[change.id] = { ...node.position };
            }
          }
        }
      });

      const moveOperations = nonRemoveChanges
        .filter((change) => change.type === "position" && change.dragging === false)
        .map((change) => {
          const currentNode = editorStateRef.current.nodes.find((n) => n.id === change.id);
          const safePosition = change.position || currentNode?.position;
          const startPos = dragStartPosRef.current[change.id] || null;
          delete dragStartPosRef.current[change.id];

          return createBlockMoveOp(
            change.id,
            safePosition,
            startPos,
            getCurrentVersion()
          );
        })
        .filter(Boolean);

      const directChanges = nonRemoveChanges.filter(
        (change) => !(change.type === "position" && change.dragging === false)
      );

      if (directChanges.length > 0) {
        setEditorState((prev) => {
          const next = {
            ...prev,
            nodes: applyNodeChanges(directChanges, prev.nodes),
          };
          editorStateRef.current = next;
          return next;
        });
      }

      moveOperations.forEach((operation) => dispatchOperation(operation));
    },
    [dispatchOperation, getCurrentVersion]
  );

  const onEdgesChange = useCallback((changes) => {
    const nonRemoveChanges = changes.filter((change) => change.type !== "remove");
    if (nonRemoveChanges.length === 0) return;

    setEditorState((prev) => {
      const next = {
        ...prev,
        edges: applyEdgeChanges(nonRemoveChanges, prev.edges),
      };
      editorStateRef.current = next;
      return next;
    });
  }, []);

  const onNodesDelete = useCallback(
    (deleted) => {
      deleted.forEach((node) => {
        dispatchOperation(createBlockDeleteOp(node.id, getCurrentVersion()));
      });

      setSelectedNodeId((sel) =>
        deleted.some((node) => node.id === sel) ? null : sel
      );
    },
    [dispatchOperation, getCurrentVersion]
  );

  const onEdgesDelete = useCallback(
    (deleted) => {
      deleted.forEach((edge) => {
        dispatchOperation(createEdgeDeleteOp(edge.id, getCurrentVersion()));
      });
    },
    [dispatchOperation, getCurrentVersion]
  );

  const onNodeContextMenu = useCallback((event, node) => {
    event.preventDefault();
    setSelectedNodeId(node.id);
    setShowInspectorModal(true);
  }, []);

  const onEdgeContextMenu = useCallback(
    (event, edge) => {
      event.preventDefault();
      const ok = globalThis.confirm("Удалить соединение?");
      if (ok) {
        dispatchOperation(createEdgeDeleteOp(edge.id, getCurrentVersion()));
      }
    },
    [dispatchOperation, getCurrentVersion]
  );

  const onEdgeDoubleClick = useCallback((event, edge) => {
    event.preventDefault();
    setEditingEdgeId(edge.id);
  }, []);

  const onNodeClick = useCallback((event, node) => {
    setSelectedNodeId(node.id);
  }, []);

  const closeInspectorModal = useCallback(() => {
    setShowInspectorModal(false);
  }, []);

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNodeId) return;

    const ok = globalThis.confirm("Удалить блок и все его соединения?");
    if (!ok) return;

    dispatchOperation(createBlockDeleteOp(selectedNodeId, getCurrentVersion()));
    setSelectedNodeId(null);
    setShowInspectorModal(false);
  }, [selectedNodeId, dispatchOperation, getCurrentVersion]);

  const extractUsedVariables = useCallback(() => {
    const vars = new Set();

    if (globalVariables) {
      globalVariables.split("\n").forEach((v) => {
        const trimmed = v.trim();
        if (trimmed) vars.add(trimmed);
      });
    }

    nodes.forEach((node) => {
      if (node.type === "input" && node.data.variableName) {
        vars.add(node.data.variableName);
      }
    });

    return Array.from(vars).sort();
  }, [nodes, globalVariables]);

  useEffect(() => {
    setLoadingBots(true);

    fetchBotsApi()
      .then((data) => {
        if (Array.isArray(data)) {
          setBots(data);
        } else {
          setBots([]);
        }
      })
      .catch((e) => {
        console.error("Failed to fetch bots", e);
        setBots([]);
      })
      .finally(() => setLoadingBots(false));
  }, []);

  const saveCurrentBot = async () => {
    const scenario = toScenario(nodes, edges);
    scenario.BotName = botName;
    scenario.Token = botToken;
    scenario.GlobalVariables = globalVariables
      .split("\n")
      .filter((v) => v.trim());

    const { valid, errors } = validateScenario(
      nodes,
      edges,
      scenario.GlobalVariables
    );

    if (!valid) {
      alert("Ошибки в конфигурации:\n" + errors.join("\n"));
      return;
    }

    const defaultName = scenario.BotName || "Новый бот";
    const name = globalThis.prompt("Введите имя бота", defaultName);
    if (!name) return;

    const existing = bots.find((b) => b.name === name);

    try {
      if (existing) {
        const updated = await updateBotApi({
          id: existing.id,
          name,
          scenario,
        });

        setBots((prev) =>
          prev.map((b) => (b.id === existing.id ? updated : b))
        );
      } else {
        const created = await createBotApi({ name, scenario });
        setBots((prev) => [...prev, created]);
      }

      alert("Бот сохранён.");
    } catch (e) {
      alert("Не удалось сохранить бота: " + e.message);
    }
  };

  const handleValidate = () => {
    const vars = globalVariables.split("\n").filter((v) => v.trim());
    const { valid, errors } = validateScenario(nodes, edges, vars);

    if (valid) {
      alert("Конфигурация корректна");
    } else {
      alert("Ошибки:\n" + errors.join("\n"));
    }
  };

  const handleSelectBot = (bot) => {
    const { nodes: newNodes, edges: newEdges } = fromScenario(bot.scenario);

    replaceEditorState(
      { nodes: newNodes, edges: newEdges },
      { resetHistory: true }
    );

    setSelectedNodeId(null);
    setBotName(bot.scenario.BotName || bot.name);
    setBotToken(bot.scenario.Token || "");

    if (
      bot.scenario.GlobalVariables &&
      Array.isArray(bot.scenario.GlobalVariables)
    ) {
      setGlobalVariables(bot.scenario.GlobalVariables.join("\n"));
    } else {
      setGlobalVariables("");
    }

    setView("editor");
  };

  const handleNewBot = (name) => {
    replaceEditorState({ nodes: [], edges: [] }, { resetHistory: true });
    setSelectedNodeId(null);
    setBotName(name || "Bot");
    setBotToken("");
    setGlobalVariables("");
    setView("editor");
  };

  const handleDeleteBot = async (botId) => {
    const ok = globalThis.confirm("Удалить бота и его сценарий?");
    if (!ok) return;

    try {
      await deleteBotApi(botId);
      setBots((prev) => prev.filter((b) => b.id !== botId));
    } catch (e) {
      alert("Не удалось удалить бота: " + e.message);
    }
  };

  const handleExportScenario = () => {
    const scenario = toScenario(nodes, edges);
    scenario.BotName = botName;
    scenario.Token = botToken;
    scenario.GlobalVariables = globalVariables
      .split("\n")
      .filter((v) => v.trim());

    const blob = new Blob([JSON.stringify(scenario, null, 2)], {
      type: "application/json",
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${scenario.BotName || "bot"}-bot-scenario.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result);
        const { nodes: newNodes, edges: newEdges } = fromScenario(json);

        dispatchOperation(
          createScenarioReplaceOp(
            { nodes: newNodes, edges: newEdges },
            getCurrentVersion()
          )
        );

        setSelectedNodeId(null);

        if (json.BotName) setBotName(json.BotName);
        if (json.Token) setBotToken(json.Token);

        if (json.GlobalVariables && Array.isArray(json.GlobalVariables)) {
          setGlobalVariables(json.GlobalVariables.join("\n"));
        } else {
          setGlobalVariables("");
        }
      } catch (e) {
        alert("Ошибка загрузки сценария: " + e.message);
      }
    };

    reader.readAsText(file);
    event.target.value = "";
  };

  const updateNodeData = (id, patch) => {
    dispatchOperation(createBlockUpdateOp(id, patch, getCurrentVersion()));
  };

  const renderInspector = () => {
    const node = nodes.find((n) => n.id === selectedNodeId);
    if (!node) return <div>Выберите блок для редактирования</div>;

    const usedVars = extractUsedVariables();

    switch (node.type) {
      case "message":
        return (
          <MessageInspector
            node={node}
            updateNodeData={updateNodeData}
            usedVars={usedVars}
          />
        );

      case "input":
        return <InputInspector node={node} updateNodeData={updateNodeData} />;

      case "condition":
        return (
          <ConditionInspector
            node={node}
            updateNodeData={updateNodeData}
            usedVars={usedVars}
          />
        );

      case "choice":
        return (
          <ChoiceInspector
            node={node}
            updateNodeData={updateNodeData}
            usedVars={usedVars}
          />
        );

      case "api":
        return <ApiInspector node={node} updateNodeData={updateNodeData} />;

      default:
        return <DefaultInspector />;
    }
  };

  if (view === "manager") {
    return (
      <ReactFlowProvider>
        <div className="app">
          <BotsManager
            bots={bots}
            loading={loadingBots}
            onSelectBot={handleSelectBot}
            onNewBot={handleNewBot}
            onDeleteBot={handleDeleteBot}
          />
        </div>
      </ReactFlowProvider>
    );
  }

  return (
    <ReactFlowProvider>
      <div
        className="app"
        style={{
          display: "flex",
          width: "100vw",
          height: "100vh",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          className="sidebar"
          style={{
            width: 260,
            minWidth: 260,
            maxWidth: 260,
            background: "#f7f7f7",
            borderRight: "1px solid #ddd",
            padding: 16,
            boxSizing: "border-box",
            overflowY: "auto",
            overflowX: "hidden",
            zIndex: 20,
            position: "relative",
          }}
        >
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "#777" }}>Пользователь</div>
            <div style={{ fontWeight: 600 }}>
              {user?.email || "Неизвестно"}
            </div>
            <button
              style={{ marginTop: 8, background: "#d32f2f", color: "#fff" }}
              onClick={logout}
            >
              Выйти
            </button>
          </div>

          <h3>Блоки</h3>

          {["start", "final", "message", "input", "condition", "choice", "api"].map(
            (t) => (
              <div
                key={t}
                className="block-item"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/reactflow", t);
                  e.dataTransfer.effectAllowed = "move";
                }}
                style={{
                  padding: "10px 12px",
                  marginBottom: 8,
                  background: "#fff",
                  border: "1px solid #ddd",
                  borderRadius: 8,
                  cursor: "grab",
                  userSelect: "none",
                }}
              >
                {t}
              </div>
            )
          )}

          <button onClick={handleImportClick} style={{ width: "100%", marginTop: 8 }}>
            Импорт
          </button>

          <button onClick={handleExportScenario} style={{ width: "100%", marginTop: 8 }}>
            Экспорт
          </button>

          <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
            <button 
              onClick={handleUndo} 
              disabled={undoStack.length === 0}
              style={{ flex: 1, opacity: undoStack.length === 0 ? 0.5 : 1 }}
            >
              ↩ Отменить
            </button>
            <button 
              onClick={handleRedo} 
              disabled={redoStack.length === 0}
              style={{ flex: 1, opacity: redoStack.length === 0 ? 0.5 : 1 }}
            >
              ↪ Повторить
            </button>
          </div>

          <button
            onClick={() => setShowBotSettings(true)}
            className="mt8"
            style={{ width: "100%", marginTop: 8 }}
          >
            Параметры
          </button>

          <button
            onClick={saveCurrentBot}
            className="mt8"
            style={{ width: "100%", marginTop: 8 }}
          >
            Сохранить бота
          </button>

          <button
            onClick={() => setView("manager")}
            className="mt8"
            style={{ width: "100%", marginTop: 8 }}
          >
            Мои боты
          </button>

          <button
            onClick={handleValidate}
            className="mt8"
            style={{ width: "100%", marginTop: 8 }}
          >
            Проверить
          </button>

          <input
            type="file"
            accept="application/json"
            className="hidden-input"
            ref={fileInputRef}
            onChange={handleFileChange}
          />
        </div>

        <div style={{ flex: 1, minWidth: 0, height: "100vh", position: "relative" }}>
          <Canvas
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onNodeContextMenu={onNodeContextMenu}
            onEdgeContextMenu={onEdgeContextMenu}
            onEdgeDoubleClick={onEdgeDoubleClick}
            onNodesDelete={onNodesDelete}
            onEdgesDelete={onEdgesDelete}
            dispatchOperation={dispatchOperation}
            getCurrentVersion={getCurrentVersion}
            editingEdgeId={editingEdgeId}
            setEditingEdgeId={setEditingEdgeId}
          />
        </div>

        {showInspectorModal && (
          <div
            className="modal-overlay"
            onClick={() => setShowInspectorModal(false)}
          >
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <strong>Редактирование блока</strong>
                <div>
                  <button onClick={closeInspectorModal}>Закрыть</button>
                  <button onClick={deleteSelectedNode}>Удалить блок</button>
                </div>
              </div>
              <div>{renderInspector()}</div>
            </div>
          </div>
        )}

        {showBotSettings && (
          <div
            className="modal-overlay"
            onClick={() => setShowBotSettings(false)}
          >
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <strong>Глобальные параметры</strong>
                <button onClick={() => setShowBotSettings(false)}>
                  Закрыть
                </button>
              </div>

              <label>
                <strong>Имя бота</strong>
                <input
                  type="text"
                  value={botName}
                  onChange={(e) => setBotName(e.target.value)}
                />
              </label>

              <label>
                <strong>Токен</strong>
                <textarea
                  rows="3"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                />
              </label>

              <label>
                <strong>Глобальные переменные (одна в строке)</strong>
                <textarea
                  rows="5"
                  value={globalVariables}
                  onChange={(e) => setGlobalVariables(e.target.value)}
                  placeholder="var1&#10;var2&#10;user_name"
                />
              </label>
            </div>
          </div>
        )}
      </div>

      <ChatPreview
        nodes={nodes}
        edges={edges}
        globalVariables={globalVariables.split("\n").filter((v) => v.trim())}
      />
    </ReactFlowProvider>
  );
}
