import React, {
  useCallback,
  useRef,
  useState,
  useEffect,
} from "react";
import {
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  addEdge,
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

const nodeTypes = {
  start: StartNode,
  final: FinalNode,
  message: MessageNode,
  input: InputNode,
  condition: ConditionNode,
  choice: ChoiceNode,
  api: ApiNode,
};

/**
 * Основная оболочка редактора бота.
 * Отвечает за:
 *  - загрузку и сохранение ботов через backend API
 *  - состояние React Flow (узлы, рёбра)
 *  - вызов валидатора конфигурации
 *  - отображение сайдбара, канваса, инспекторов и превью-чата
 */
function BotEditorShell() {
  const { user, logout } = useAuth();

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
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

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const onNodesDelete = useCallback(
    (deleted) => {
      setNodes((nds) => nds.filter((n) => !deleted.some((d) => d.id === n.id)));
      setEdges((eds) =>
        eds.filter(
          (e) => !deleted.some((d) => e.source === d.id || e.target === d.id)
        )
      );
      setSelectedNodeId((sel) =>
        deleted.some((d) => d.id === sel) ? null : sel
      );
    },
    [setNodes, setEdges]
  );

  const onEdgesDelete = useCallback(
    (deleted) => {
      setEdges((eds) => eds.filter((e) => !deleted.some((d) => d.id === e.id)));
    },
    [setEdges]
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
        setEdges((eds) => eds.filter((e) => e.id !== edge.id));
      }
    },
    [setEdges]
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
    setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
    setEdges((eds) =>
      eds.filter(
        (e) => e.source !== selectedNodeId && e.target !== selectedNodeId
      )
    );
    setSelectedNodeId(null);
    setShowInspectorModal(false);
  }, [selectedNodeId, setNodes, setEdges]);

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
    setNodes(newNodes);
    setEdges(newEdges);
    setSelectedNodeId(null);
    setBotName(bot.scenario.BotName || bot.name);
    setBotToken(bot.scenario.Token || "");
    if (bot.scenario.GlobalVariables && Array.isArray(bot.scenario.GlobalVariables)) {
      setGlobalVariables(bot.scenario.GlobalVariables.join("\n"));
    } else {
      setGlobalVariables("");
    }
    setView("editor");
  };

  const handleNewBot = (name) => {
    setNodes([]);
    setEdges([]);
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
    a.download = scenario.BotName + "-bot-scenario.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const fileInputRef = useRef(null);

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
        setNodes(newNodes);
        setEdges(newEdges);
        setSelectedNodeId(null);
        if (json.BotName) setBotName(json.BotName);
        if (json.Token) setBotToken(json.Token);
        if (json.GlobalVariables && Array.isArray(json.GlobalVariables)) {
          setGlobalVariables(json.GlobalVariables.join("\n"));
        }
      } catch (e) {
        alert("Ошибка загрузки сценария: " + e.message);
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const updateNodeData = (id, patch) => {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === id) {
          return {
            ...n,
            data: {
              ...n.data,
              ...patch,
            },
          };
        }
        return n;
      })
    );
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
      <div className="app">
        <div className="sidebar">
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "#777" }}>Пользователь</div>
            <div style={{ fontWeight: 600 }}>{user?.email || "Неизвестно"}</div>
            <button
              style={{ marginTop: 8, background: "#d32f2f" }}
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
              >
                {t}
              </div>
            )
          )}
          <button onClick={handleImportClick}>Импорт</button>
          <button onClick={handleExportScenario}>Экспорт</button>
          <button onClick={() => setShowBotSettings(true)} className="mt8">
            Параметры
          </button>
          <button onClick={saveCurrentBot} className="mt8">
            Сохранить бота
          </button>
          <button onClick={() => setView("manager")} className="mt8">
            Мои боты
          </button>
          <button onClick={handleValidate} className="mt8">
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
          setNodes={setNodes}
          setEdges={setEdges}
          editingEdgeId={editingEdgeId}
          setEditingEdgeId={setEditingEdgeId}
        />

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

export default BotEditorShell;

