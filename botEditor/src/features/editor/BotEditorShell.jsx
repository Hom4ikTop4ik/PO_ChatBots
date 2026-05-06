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

import {
  CollaborationProvider,
  ParticipantsBar,
  useCollaboration,
  fetchCollabScenarioMeta,
} from "../collaboration";

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

  const [currentBotId, setCurrentBotId] = useState(null);

  const [isCurrentBotOwner, setIsCurrentBotOwner] = useState(true);

  const [toast, setToast] = useState(null);

  const fileInputRef = useRef(null);
  const editorStateRef = useRef(INITIAL_EDITOR_STATE);
  const scenarioVersionRef = useRef(0);
  const dragStartPosRef = useRef({});

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
      get currentBotId() {
        return currentBotId;
      },
    };
  }, [operationLog, currentBotId]);

  const showToast = useCallback((text, kind = "info") => {
    setToast({ text, kind, ts: Date.now() });
    setTimeout(() => {
      setToast((cur) => (cur && cur.ts ? null : cur));
    }, 3500);
  }, []);

  useEffect(() => {
    setLoadingBots(true);
    fetchBotsApi()
      .then((data) => {
        if (Array.isArray(data)) setBots(data);
        else setBots([]);
      })
      .catch((e) => {
        console.error("Failed to fetch bots", e);
        setBots([]);
      })
      .finally(() => setLoadingBots(false));
  }, []);

  const handleSnapshot = useCallback(({ state, version }) => {
    if (state) {
      const next = {
        nodes: state.nodes || [],
        edges: state.edges || [],
      };
      setEditorState(next);
      editorStateRef.current = next;
    }
    setScenarioVersion(version || 0);
    scenarioVersionRef.current = version || 0;
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  const handleRemoteOp = useCallback(({ op, applied_version }) => {
    setEditorState((prev) => {
      const next = applyOperation(prev, op);
      editorStateRef.current = next;
      return next;
    });
    setScenarioVersion(applied_version);
    scenarioVersionRef.current = applied_version;
    setOperationLog((prev) => {
      const entry = { ...op, applied_version, remote: true };
      return [...prev, entry].slice(-200);
    });
  }, []);

  const handleOpAccepted = useCallback(({ applied_version }) => {
    setScenarioVersion(applied_version);
    scenarioVersionRef.current = applied_version;
  }, []);

  const handleOpRejected = useCallback(({ op, reason }) => {
    if (!op) {
      showToast(`Операция отклонена: ${reason || "конфликт"}`, "error");
      return;
    }
    const inverse = createInverseOperation(editorStateRef.current, op);
    if (inverse) {
      setEditorState((prev) => {
        const next = applyOperation(prev, inverse);
        editorStateRef.current = next;
        return next;
      });
    }
    setUndoStack((prev) =>
      prev.filter((entry) => entry.original.op_id !== op.op_id)
    );
    const reasonText =
      reason === "target_deleted" || reason === "transformed_to_noop"
        ? "блок был удалён другим участником"
        : reason === "endpoint_deleted"
        ? "конечная точка связи удалена"
        : reason === "future_base_version"
        ? "рассинхронизация версии"
        : reason || "конфликт";
    showToast(`Изменение отменено: ${reasonText}`, "warning");
  }, [showToast]);

  const handleOpsReplay = useCallback(({ ops }) => {
    if (!Array.isArray(ops) || ops.length === 0) return;
    setEditorState((prev) => {
      let cur = prev;
      for (const op of ops) {
        cur = applyOperation(cur, op);
      }
      editorStateRef.current = cur;
      return cur;
    });
    const last = ops[ops.length - 1];
    if (last && typeof last.applied_version === "number") {
      setScenarioVersion(last.applied_version);
      scenarioVersionRef.current = last.applied_version;
    }
  }, []);

  const handleSelectBot = useCallback((bot) => {
    const { nodes: newNodes, edges: newEdges } = fromScenario(bot.scenario);
    const next = { nodes: newNodes, edges: newEdges };
    setEditorState(next);
    editorStateRef.current = next;
    setScenarioVersion(bot.version || 0);
    scenarioVersionRef.current = bot.version || 0;
    setOperationLog([]);
    setUndoStack([]);
    setRedoStack([]);
    setSelectedNodeId(null);
    setBotName(bot.scenario.BotName || bot.name);
    setBotToken(bot.scenario.Token || "");
    setIsCurrentBotOwner(bot.is_owner !== false);
    if (bot.scenario.GlobalVariables && Array.isArray(bot.scenario.GlobalVariables)) {
      setGlobalVariables(bot.scenario.GlobalVariables.join("\n"));
    } else {
      setGlobalVariables("");
    }
    setCurrentBotId(bot.id);
    setView("editor");
  }, []);

  const handleNewBot = useCallback((name) => {
    setEditorState({ nodes: [], edges: [] });
    editorStateRef.current = { nodes: [], edges: [] };
    setScenarioVersion(0);
    scenarioVersionRef.current = 0;
    setOperationLog([]);
    setUndoStack([]);
    setRedoStack([]);
    setSelectedNodeId(null);
    setBotName(name || "Bot");
    setBotToken("");
    setGlobalVariables("");
    setCurrentBotId(null);
    setIsCurrentBotOwner(true);
    setView("editor");
  }, []);

  const handleDeleteBot = useCallback(async (botId) => {
    const ok = globalThis.confirm("Удалить бота и его сценарий?");
    if (!ok) return;
    try {
      await deleteBotApi(botId);
      setBots((prev) => prev.filter((b) => b.id !== botId));
    } catch (e) {
      alert("Не удалось удалить бота: " + e.message);
    }
  }, []);

  const handleJoinSession = useCallback(async (sessionId) => {
    const id = (sessionId || "").trim();
    if (!id) return;
    try {
      const meta = await fetchCollabScenarioMeta(id);
      handleSelectBot({
        id: meta.id,
        name: meta.name,
        scenario: meta.scenario,
        version: meta.version,
        is_owner: meta.is_owner,
      });
    } catch (e) {
      alert("Не удалось открыть сессию: " + e.message);
    }
  }, [handleSelectBot]);

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
            onJoinSession={handleJoinSession}
          />
        </div>
      </ReactFlowProvider>
    );
  }

  return (
    <ReactFlowProvider>
      <CollaborationProvider
        scenarioId={currentBotId}
        onSnapshot={handleSnapshot}
        onRemoteOp={handleRemoteOp}
        onOpAccepted={handleOpAccepted}
        onOpRejected={handleOpRejected}
        onOpsReplay={handleOpsReplay}
      >
        <ShellContent
          editorState={editorState}
          setEditorState={setEditorState}
          editorStateRef={editorStateRef}
          scenarioVersion={scenarioVersion}
          setScenarioVersion={setScenarioVersion}
          scenarioVersionRef={scenarioVersionRef}
          operationLog={operationLog}
          setOperationLog={setOperationLog}
          undoStack={undoStack}
          setUndoStack={setUndoStack}
          redoStack={redoStack}
          setRedoStack={setRedoStack}
          dragStartPosRef={dragStartPosRef}
          selectedNodeId={selectedNodeId}
          setSelectedNodeId={setSelectedNodeId}
          showInspectorModal={showInspectorModal}
          setShowInspectorModal={setShowInspectorModal}
          editingEdgeId={editingEdgeId}
          setEditingEdgeId={setEditingEdgeId}
          botName={botName}
          setBotName={setBotName}
          botToken={botToken}
          setBotToken={setBotToken}
          globalVariables={globalVariables}
          setGlobalVariables={setGlobalVariables}
          showBotSettings={showBotSettings}
          setShowBotSettings={setShowBotSettings}
          fileInputRef={fileInputRef}
          bots={bots}
          setBots={setBots}
          setView={setView}
          currentBotId={currentBotId}
          setCurrentBotId={setCurrentBotId}
          isCurrentBotOwner={isCurrentBotOwner}
          user={user}
          logout={logout}
          showToast={showToast}
          toast={toast}
        />
      </CollaborationProvider>
    </ReactFlowProvider>
  );
}

function ShellContent(props) {
  const {
    editorState,
    setEditorState,
    editorStateRef,
    scenarioVersionRef,
    setScenarioVersion,
    operationLog,
    setOperationLog,
    undoStack,
    setUndoStack,
    redoStack,
    setRedoStack,
    dragStartPosRef,
    selectedNodeId,
    setSelectedNodeId,
    showInspectorModal,
    setShowInspectorModal,
    editingEdgeId,
    setEditingEdgeId,
    botName,
    setBotName,
    botToken,
    setBotToken,
    globalVariables,
    setGlobalVariables,
    showBotSettings,
    setShowBotSettings,
    fileInputRef,
    bots,
    setBots,
    setView,
    currentBotId,
    setCurrentBotId,
    isCurrentBotOwner,
    user,
    logout,
    showToast,
    toast,
  } = props;

  const collab = useCollaboration();

  const nodes = editorState.nodes;
  const edges = editorState.edges;

  const getCurrentVersion = useCallback(
    () => scenarioVersionRef.current,
    [scenarioVersionRef]
  );


  const dispatchOperation = useCallback(
    (operation, isHistoryAction = false) => {
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

      if (!collab.enabled) {
        setScenarioVersion((prev) => {
          const next = prev + 1;
          scenarioVersionRef.current = next;
          return next;
        });
      }

      setOperationLog((prev) => {
        const entry = {
          ...operation,
          applied_version: scenarioVersionRef.current + (collab.enabled ? 0 : 0),
        };
        const next = [...prev, entry];
        return next.slice(-200);
      });

      if (!isHistoryAction && inverseOp) {
        setUndoStack((prev) => [...prev, { original: operation, inverse: inverseOp }]);
        setRedoStack([]);
      }

      if (collab.enabled && !isHistoryAction) {
        collab.publishOperation(operation);
      }
    },
    [
      collab,
      editorStateRef,
      scenarioVersionRef,
      setEditorState,
      setOperationLog,
      setRedoStack,
      setScenarioVersion,
      setUndoStack,
    ]
  );

  const handleUndo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      const newUndo = prev.slice(0, -1);
      dispatchOperation(last.inverse, true);
      if (collab.enabled) collab.publishOperation(last.inverse);
      setRedoStack((r) => [...r, last]);
      return newUndo;
    });
  }, [dispatchOperation, collab, setRedoStack, setUndoStack]);

  const handleRedo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      const newRedo = prev.slice(0, -1);
      dispatchOperation(last.original, true);
      if (collab.enabled) collab.publishOperation(last.original);
      setUndoStack((u) => [...u, last]);
      return newRedo;
    });
  }, [dispatchOperation, collab, setRedoStack, setUndoStack]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      const isInput = e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA";
      if (isInput) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleUndo, handleRedo]);

  const onConnect = useCallback(
    (params) => {
      dispatchOperation(createEdgeAddOp(params, getCurrentVersion()));
    },
    [dispatchOperation, getCurrentVersion]
  );

  const onNodesChange = useCallback(
    (changes) => {
      const nonRemoveChanges = changes.filter((c) => c.type !== "remove");
      if (nonRemoveChanges.length === 0) return;

      nonRemoveChanges.forEach((change) => {
        if (change.type === "position" && change.dragging) {
          if (!dragStartPosRef.current[change.id]) {
            const node = editorStateRef.current.nodes.find((n) => n.id === change.id);
            if (node) dragStartPosRef.current[change.id] = { ...node.position };
          }
          if (collab.enabled && change.position) {
            collab.updatePresence({
              dragging_block: {
                block_id: change.id,
                x: change.position.x,
                y: change.position.y,
              },
            });
          }
        }
      });

      const moveOperations = nonRemoveChanges
        .filter((c) => c.type === "position" && c.dragging === false)
        .map((change) => {
          const currentNode = editorStateRef.current.nodes.find((n) => n.id === change.id);
          const safePosition = change.position || currentNode?.position;
          const startPos = dragStartPosRef.current[change.id] || null;
          delete dragStartPosRef.current[change.id];
          if (collab.enabled) {
            collab.updatePresence({ dragging_block: null });
          }
          return createBlockMoveOp(
            change.id,
            safePosition,
            startPos,
            getCurrentVersion()
          );
        })
        .filter(Boolean);

      const directChanges = nonRemoveChanges.filter(
        (c) => !(c.type === "position" && c.dragging === false)
      );

      if (directChanges.length > 0) {
        setEditorState((prev) => {
          const next = { ...prev, nodes: applyNodeChanges(directChanges, prev.nodes) };
          editorStateRef.current = next;
          return next;
        });
      }

      moveOperations.forEach((op) => dispatchOperation(op));
    },
    [
      dispatchOperation,
      getCurrentVersion,
      collab,
      dragStartPosRef,
      editorStateRef,
      setEditorState,
    ]
  );

  const onEdgesChange = useCallback(
    (changes) => {
      const nonRemoveChanges = changes.filter((c) => c.type !== "remove");
      if (nonRemoveChanges.length === 0) return;
      setEditorState((prev) => {
        const next = { ...prev, edges: applyEdgeChanges(nonRemoveChanges, prev.edges) };
        editorStateRef.current = next;
        return next;
      });
    },
    [editorStateRef, setEditorState]
  );

  const onNodesDelete = useCallback(
    (deleted) => {
      deleted.forEach((node) => {
        dispatchOperation(createBlockDeleteOp(node.id, getCurrentVersion()));
      });
      setSelectedNodeId((sel) => (deleted.some((n) => n.id === sel) ? null : sel));
    },
    [dispatchOperation, getCurrentVersion, setSelectedNodeId]
  );

  const onEdgesDelete = useCallback(
    (deleted) => {
      deleted.forEach((edge) => {
        dispatchOperation(createEdgeDeleteOp(edge.id, getCurrentVersion()));
      });
    },
    [dispatchOperation, getCurrentVersion]
  );

  const onNodeContextMenu = useCallback(
    (event, node) => {
      event.preventDefault();
      setSelectedNodeId(node.id);
      setShowInspectorModal(true);
      if (collab.enabled) {
        collab.updatePresence({ selected_block_id: node.id });
      }
    },
    [collab, setSelectedNodeId, setShowInspectorModal]
  );

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

  const onEdgeDoubleClick = useCallback(
    (event, edge) => {
      event.preventDefault();
      setEditingEdgeId(edge.id);
    },
    [setEditingEdgeId]
  );

  const onNodeClick = useCallback(
    (event, node) => {
      setSelectedNodeId(node.id);
      if (collab.enabled) {
        collab.updatePresence({ selected_block_id: node.id });
      }
    },
    [collab, setSelectedNodeId]
  );

  const closeInspectorModal = useCallback(() => {
    setShowInspectorModal(false);
    if (collab.enabled) {
      collab.updatePresence({ selected_block_id: null });
    }
  }, [collab, setShowInspectorModal]);

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNodeId) return;
    const ok = globalThis.confirm("Удалить блок и все его соединения?");
    if (!ok) return;
    dispatchOperation(createBlockDeleteOp(selectedNodeId, getCurrentVersion()));
    setSelectedNodeId(null);
    setShowInspectorModal(false);
  }, [
    selectedNodeId,
    dispatchOperation,
    getCurrentVersion,
    setSelectedNodeId,
    setShowInspectorModal,
  ]);

  const extractUsedVariables = useCallback(() => {
    const vars = new Set();
    if (globalVariables) {
      globalVariables.split("\n").forEach((v) => {
        const t = v.trim();
        if (t) vars.add(t);
      });
    }
    nodes.forEach((node) => {
      if (node.type === "input" && node.data.variableName) {
        vars.add(node.data.variableName);
      }
    });
    return Array.from(vars).sort();
  }, [nodes, globalVariables]);

  const saveCurrentBot = useCallback(async () => {
    const scenario = toScenario(nodes, edges);
    scenario.BotName = botName;
    scenario.Token = botToken;
    scenario.GlobalVariables = globalVariables.split("\n").filter((v) => v.trim());

    const { valid, errors } = validateScenario(nodes, edges, scenario.GlobalVariables);
    if (!valid) {
      alert("Ошибки в конфигурации:\n" + errors.join("\n"));
      return;
    }

    if (collab.enabled && !isCurrentBotOwner) {
      alert("Сохранение доступно только владельцу сценария.");
      return;
    }

    const defaultName = scenario.BotName || "Новый бот";
    const name = globalThis.prompt("Введите имя бота", defaultName);
    if (!name) return;

    const existing = bots.find((b) => b.name === name);

    try {
      if (existing) {
        const updated = await updateBotApi({ id: existing.id, name, scenario });
        setBots((prev) => prev.map((b) => (b.id === existing.id ? updated : b)));
        if (!currentBotId) setCurrentBotId(existing.id);
      } else {
        const created = await createBotApi({ name, scenario });
        setBots((prev) => [...prev, created]);
        if (!currentBotId) setCurrentBotId(created.id);
      }
      alert("Бот сохранён.");
    } catch (e) {
      alert("Не удалось сохранить бота: " + e.message);
    }
  }, [
    nodes,
    edges,
    botName,
    botToken,
    globalVariables,
    bots,
    setBots,
    currentBotId,
    setCurrentBotId,
    collab.enabled,
    isCurrentBotOwner,
  ]);

  const handleValidate = useCallback(() => {
    const vars = globalVariables.split("\n").filter((v) => v.trim());
    const { valid, errors } = validateScenario(nodes, edges, vars);
    if (valid) alert("Конфигурация корректна");
    else alert("Ошибки:\n" + errors.join("\n"));
  }, [nodes, edges, globalVariables]);

  const handleExportScenario = useCallback(() => {
    const scenario = toScenario(nodes, edges);
    scenario.BotName = botName;
    scenario.Token = botToken;
    scenario.GlobalVariables = globalVariables.split("\n").filter((v) => v.trim());
    const blob = new Blob([JSON.stringify(scenario, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${scenario.BotName || "bot"}-bot-scenario.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [nodes, edges, botName, botToken, globalVariables]);

  const handleImportClick = useCallback(() => {
    if (collab.enabled && collab.participants.length > 1) {
      const others = collab.participants
        .filter((p) => p.user_id !== collab.you?.user_id)
        .map((p) => p.display_name)
        .join(", ");
      const ok = globalThis.confirm(
        `В сессии активны другие участники (${others}). ` +
        `Импорт полностью заменит сценарий. Продолжить?`
      );
      if (!ok) return;
    }
    if (fileInputRef.current) fileInputRef.current.click();
  }, [collab, fileInputRef]);

  const handleFileChange = useCallback((event) => {
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
  }, [
    dispatchOperation,
    getCurrentVersion,
    setSelectedNodeId,
    setBotName,
    setBotToken,
    setGlobalVariables,
  ]);

  const updateNodeData = useCallback(
    (id, patch) => {
      dispatchOperation(createBlockUpdateOp(id, patch, getCurrentVersion()));
    },
    [dispatchOperation, getCurrentVersion]
  );

  const renderInspector = () => {
    const node = nodes.find((n) => n.id === selectedNodeId);
    if (!node) return <div>Выберите блок для редактирования</div>;
    const usedVars = extractUsedVariables();
    switch (node.type) {
      case "message":
        return <MessageInspector node={node} updateNodeData={updateNodeData} usedVars={usedVars} />;
      case "input":
        return <InputInspector node={node} updateNodeData={updateNodeData} />;
      case "condition":
        return <ConditionInspector node={node} updateNodeData={updateNodeData} usedVars={usedVars} />;
      case "choice":
        return <ChoiceInspector node={node} updateNodeData={updateNodeData} usedVars={usedVars} />;
      case "api":
        return <ApiInspector node={node} updateNodeData={updateNodeData} />;
      default:
        return <DefaultInspector />;
    }
  };

  return (
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
      {currentBotId && (
        <div style={{ position: "absolute", top: 0, left: 260, right: 0, zIndex: 25 }}>
          <ParticipantsBar scenarioId={currentBotId} />
        </div>
      )}

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
          <div style={{ fontWeight: 600 }}>{user?.email || "Неизвестно"}</div>
          <button
            style={{ marginTop: 8, background: "#d32f2f", color: "#fff" }}
            onClick={logout}
          >
            Выйти
          </button>
        </div>

        <h3>Блоки</h3>

        {["start", "final", "message", "input", "condition", "choice", "api"].map((t) => (
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
        ))}

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

        {(isCurrentBotOwner || !collab.enabled) && (
          <button
            onClick={saveCurrentBot}
            className="mt8"
            style={{ width: "100%", marginTop: 8 }}
          >
            Сохранить бота
          </button>
        )}

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

      <div
        style={{
          flex: 1,
          minWidth: 0,
          height: "100vh",
          position: "relative",
          paddingTop: currentBotId ? 40 : 0,
          boxSizing: "border-box",
        }}
      >
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

      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            background:
              toast.kind === "warning"
                ? "#fff8e1"
                : toast.kind === "error"
                ? "#ffebee"
                : "#e3f2fd",
            border: "1px solid #ccc",
            padding: "10px 14px",
            borderRadius: 6,
            zIndex: 100,
            maxWidth: 360,
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            fontSize: 13,
          }}
        >
          {toast.text}
        </div>
      )}

      {showInspectorModal && (
        <div className="modal-overlay" onClick={closeInspectorModal}>
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
        <div className="modal-overlay" onClick={() => setShowBotSettings(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <strong>Глобальные параметры</strong>
              <button onClick={() => setShowBotSettings(false)}>Закрыть</button>
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

      <ChatPreview
        nodes={nodes}
        edges={edges}
        globalVariables={globalVariables.split("\n").filter((v) => v.trim())}
      />
    </div>
  );
}
