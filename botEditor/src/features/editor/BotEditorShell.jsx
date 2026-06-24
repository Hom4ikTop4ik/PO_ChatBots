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
  copyBotApi,
  collabSaveBotApi,
  recordBotAccessApi,
  shareSessionApi,
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
  const [globalVariables, setGlobalVariables] = useState([]); // [{name, value}, ...]
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
  const [collabSessionId, setCollabSessionId] = useState(null);

  const [isCurrentBotOwner, setIsCurrentBotOwner] = useState(true);

  const [toast, setToast] = useState(null);

  const fileInputRef = useRef(null);
  const editorStateRef = useRef(INITIAL_EDITOR_STATE);
  const scenarioVersionRef = useRef(0);
  const dragStartPosRef = useRef({});
  const replaceAppliedRef = useRef(null);

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
      .then(async (data) => {
        const list = Array.isArray(data) ? data : [];
        setBots(list);

        // One-time migration: move old localStorage joinedBotIds → bot_access table
        try {
          const oldIds = JSON.parse(localStorage.getItem("joinedBotIds") || "[]");
          if (oldIds.length > 0) {
            const existingIds = new Set(list.map((b) => b.id));
            await Promise.all(
              oldIds
                .filter((id) => !existingIds.has(id))
                .map((id) => recordBotAccessApi(id).catch(() => null))
            );
            localStorage.removeItem("joinedBotIds");
            const refreshed = await fetchBotsApi().catch(() => null);
            if (Array.isArray(refreshed)) setBots(refreshed);
          }
        } catch {}
      })
      .catch(() => setBots([]))
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

  const handleReplaceApplied = useCallback(() => {
    if (replaceAppliedRef.current) replaceAppliedRef.current();
  }, []);

  const handleReplaceRejected = useCallback(({ reason, by }) => {
    if (reason === "rejected") showToast(`Импорт отклонён участником ${by || ""}`, "error");
    else if (reason === "timeout") showToast("Импорт отклонён: время ожидания истекло", "error");
    else if (reason === "owner_absent") showToast("Импорт запрещён: владелец не в сессии", "error");
    else showToast("Импорт отклонён", "error");
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
    setIsCurrentBotOwner(bot.is_owner !== false);
    if (bot.scenario.GlobalVariables && Array.isArray(bot.scenario.GlobalVariables)) {
      const parsed = bot.scenario.GlobalVariables
        .filter((v) => v && v.trim())
        .map((v) => {
          const eqIndex = v.indexOf("=");
          if (eqIndex === -1) {
            return { name: v.trim(), value: "" };
          }
          return { name: v.substring(0, eqIndex).trim(), value: v.substring(eqIndex + 1).trim() };
        });
      setGlobalVariables(parsed);
    } else {
      setGlobalVariables([]);
    }
    setCurrentBotId(bot.id);
    setCollabSessionId(bot.is_owner === false || bot.session_active ? bot.id : null);
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
    setGlobalVariables([]);
    setCurrentBotId(null);
    setCollabSessionId(null);
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
      const bot = { id: meta.id, name: meta.name, scenario: meta.scenario, version: meta.version, is_owner: meta.is_owner };
      handleSelectBot(bot);
      setCollabSessionId(meta.id);

      if (!meta.is_owner) {
        recordBotAccessApi(meta.id).catch(() => {});
        setBots((prev) => prev.some((b) => b.id === meta.id) ? prev : [...prev, bot]);
      }
    } catch (e) {
      alert("Не удалось открыть сессию: " + e.message);
    }
  }, [handleSelectBot]);

  useEffect(() => {
    if (loadingBots) return;
    const joinId = localStorage.getItem("pendingJoin");
    if (joinId) {
      localStorage.removeItem("pendingJoin");
      handleJoinSession(joinId);
    }
  }, [loadingBots, handleJoinSession]);

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
        scenarioId={collabSessionId}
        onSnapshot={handleSnapshot}
        onRemoteOp={handleRemoteOp}
        onOpAccepted={handleOpAccepted}
        onOpRejected={handleOpRejected}
        onOpsReplay={handleOpsReplay}
        onReplaceApplied={handleReplaceApplied}
        onReplaceRejected={handleReplaceRejected}
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
          globalVariables={globalVariables}
          setGlobalVariables={setGlobalVariables}
          showBotSettings={showBotSettings}
          setShowBotSettings={setShowBotSettings}
          fileInputRef={fileInputRef}
          bots={bots}
          setBots={setBots}
          onSelectBot={handleSelectBot}
          setView={setView}
          currentBotId={currentBotId}
          setCurrentBotId={setCurrentBotId}
          collabSessionId={collabSessionId}
          setCollabSessionId={setCollabSessionId}
          replaceAppliedRef={replaceAppliedRef}
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
    onSelectBot,
    collabSessionId,
    setCollabSessionId,
    replaceAppliedRef,
    isCurrentBotOwner,
    user,
    logout,
    showToast,
    toast,
  } = props;

  const collab = useCollaboration();
  const autoSaveTimerRef = useRef(null);
  const isCopyingRef = useRef(false);
  const pendingImportRef = useRef(null);

  const nodes = editorState.nodes;
  const edges = editorState.edges;

  useEffect(() => {
    if (collab.enabled) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(async () => {
      if (!nodes.length && !currentBotId) return;
      const scenario = toScenario(nodes, edges);
      scenario.BotName = botName;
      scenario.GlobalVariables = globalVariables
        .filter((v) => v && v.name && v.name.trim())
        .map((v) => `${v.name.trim()}=${v.value || ""}`);
      const name = botName || "Новый бот";
      try {
        if (currentBotId) {
          const updated = await updateBotApi({ id: currentBotId, name, scenario });
          setBots((prev) => prev.map((b) => (b.id === currentBotId ? updated : b)));
        } else {
          const created = await createBotApi({ name, scenario });
          setBots((prev) => [...prev, created]);
          setCurrentBotId(created.id);
        }
      } catch {
        // silent
      }
    }, 2000);
    return () => clearTimeout(autoSaveTimerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, botName, globalVariables, collab.enabled]);

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
      if (collab.enabled) {
        collab.publishOperation({
          ...last.inverse,
          op_id: crypto.randomUUID(),
          base_version: getCurrentVersion(),
        });
      }
      setRedoStack((r) => [...r, last]);
      return newUndo;
    });
  }, [dispatchOperation, collab, getCurrentVersion, setRedoStack, setUndoStack]);

  const handleRedo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      const newRedo = prev.slice(0, -1);
      dispatchOperation(last.original, true);
      if (collab.enabled) {
        collab.publishOperation({
          ...last.original,
          op_id: crypto.randomUUID(),
          base_version: getCurrentVersion(),
        });
      }
      setUndoStack((u) => [...u, last]);
      return newRedo;
    });
  }, [dispatchOperation, collab, getCurrentVersion, setRedoStack, setUndoStack]);

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

  const onPaneClick = useCallback(() => {
    if (!collab.enabled) return;
    Object.keys(dragStartPosRef.current).forEach((blockId) => {
      collab.releaseLock(blockId, "position");
      delete dragStartPosRef.current[blockId];
    });
    collab.locks
      .filter((l) => l.locked_by === collab.you?.user_id)
      .forEach((l) => collab.releaseLock(l.block_id, l.field_name));
    collab.updatePresence({ selected_block_id: null, dragging_block: null });
  }, [collab, dragStartPosRef]);

  const onNodesChange = useCallback(
    (changes) => {
      const nonRemoveChanges = changes.filter((c) => c.type !== "remove");
      if (nonRemoveChanges.length === 0) return;

      nonRemoveChanges.forEach((change) => {
        if (change.type === "position" && change.dragging) {
          if (!dragStartPosRef.current[change.id]) {
            const node = editorStateRef.current.nodes.find((n) => n.id === change.id);
            if (node) dragStartPosRef.current[change.id] = { ...node.position };
            if (collab.enabled) collab.acquireLock(change.id, "position");
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
            collab.releaseLock(change.id, "position");
          }

          // Fallback for race condition: lock/selection arrived after drag started
          if (collab.enabled) {
            const myId = collab.you?.user_id;
            const occupiedByOther =
              collab.locks.some((l) => l.block_id === change.id && l.locked_by !== myId) ||
              collab.presence.some((p) => p.user_id !== myId && p.selected_block_id === change.id);
            if (occupiedByOther && startPos) {
              setEditorState((prev) => ({
                ...prev,
                nodes: prev.nodes.map((n) =>
                  n.id === change.id ? { ...n, position: startPos } : n
                ),
              }));
              return null;
            }
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
    if (globalVariables && Array.isArray(globalVariables)) {
      globalVariables.forEach((v) => {
        if (v && v.name && v.name.trim()) {
          vars.add(v.name.trim());
        }
      });
    }
    nodes.forEach((node) => {
      if (node.type === "input" && node.data.variableName) {
        vars.add(node.data.variableName);
      }
        if (node.type === "api" && node.data.variables) {
        const variables = node.data.variables;
        Object.values(variables).forEach((varName) => {
          if (varName && typeof varName === 'string' && varName.trim()) {
            vars.add(varName.trim());
          }
        });
      }
    });
    return Array.from(vars).sort();
  }, [nodes, globalVariables]);

  const saveCurrentBot = useCallback(async () => {
    const scenario = toScenario(nodes, edges);
    scenario.BotName = botName;
    scenario.GlobalVariables = globalVariables
      .filter((v) => v && v.name && v.name.trim())
      .map((v) => `${v.name.trim()}=${v.value || ""}`);

    const { valid, errors } = validateScenario(nodes, edges, scenario.GlobalVariables);
    if (!valid) {
      alert("Ошибки в конфигурации:\n" + errors.join("\n"));
      return;
    }

    if (collab.enabled && !isCurrentBotOwner) {
      try {
        await collabSaveBotApi({ id: currentBotId, name: botName, scenario });
        showToast("Сохранено для всех участников", "success");
      } catch (e) {
        showToast("Не удалось сохранить: " + e.message, "error");
      }
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
    globalVariables,
    bots,
    setBots,
    currentBotId,
    setCurrentBotId,
    collab.enabled,
    isCurrentBotOwner,
    showToast,
  ]);

  const handleValidate = useCallback(() => {
    // Convert [{name, value}, ...] to ["name=value", ...] for validation
    const vars = globalVariables
      .filter((v) => v && v.name && v.name.trim())
      .map((v) => `${v.name.trim()}=${v.value || ""}`);
    const { valid, errors } = validateScenario(nodes, edges, vars);
    if (valid) alert("Конфигурация корректна");
    else alert("Ошибки:\n" + errors.join("\n"));
  }, [nodes, edges, globalVariables]);

  const handleExportScenario = useCallback(() => {
    const scenario = toScenario(nodes, edges);
    scenario.BotName = botName;
    scenario.GlobalVariables = globalVariables
      .filter((v) => v && v.name && v.name.trim())
      .map((v) => `${v.name.trim()}=${v.value || ""}`);
    const blob = new Blob([JSON.stringify(scenario, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${scenario.BotName || "bot"}-bot-scenario.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [nodes, edges, botName, globalVariables]);

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

  const applyImportMetadata = useCallback((json) => {
    setSelectedNodeId(null);
    if (json.BotName) setBotName(json.BotName);
    if (json.GlobalVariables && Array.isArray(json.GlobalVariables)) {
      const parsed = json.GlobalVariables
        .filter((v) => v && v.trim())
        .map((v) => {
          const eqIndex = v.indexOf("=");
          if (eqIndex === -1) {
            return { name: v.trim(), value: "" };
          }
          return { name: v.substring(0, eqIndex).trim(), value: v.substring(eqIndex + 1).trim() };
        });
      setGlobalVariables(parsed);
    } else {
      setGlobalVariables([]);
    }
  }, [setSelectedNodeId, setBotName, setGlobalVariables]);

  const handleFileChange = useCallback((event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result);
        const { nodes: newNodes, edges: newEdges } = fromScenario(json);
        const otherActive = collab.enabled
          ? collab.participants.filter(p => p.status === "active" && p.user_id !== collab.you?.user_id)
          : [];
        // Non-owners must always go through requestReplace so the backend can
        // enforce the owner-in-session check, even if no other participants are active.
        const needsApproval = collab.enabled && (!isCurrentBotOwner || otherActive.length > 0);
        if (needsApproval) {
          pendingImportRef.current = json;
          replaceAppliedRef.current = () => {
            if (pendingImportRef.current) {
              applyImportMetadata(pendingImportRef.current);
              pendingImportRef.current = null;
            }
          };
          collab.requestReplace({ nodes: newNodes, edges: newEdges });
        } else {
          dispatchOperation(createScenarioReplaceOp({ nodes: newNodes, edges: newEdges }, getCurrentVersion()));
          applyImportMetadata(json);
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
    collab,
    isCurrentBotOwner,
    applyImportMetadata,
    replaceAppliedRef,
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
        return <ApiInspector node={node} updateNodeData={updateNodeData} usedVars={usedVars} />;
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
      {collabSessionId && (
        <div style={{ position: "absolute", top: 0, left: 260, right: 0, zIndex: 25 }}>
          <ParticipantsBar scenarioId={collabSessionId} />
        </div>
      )}

      {collab.replaceVoteRequest && (
        <div className="modal-overlay" style={{ zIndex: 100 }}>
          <div className="modal" style={{ maxWidth: 360 }}>
            <h3>Запрос на импорт сценария</h3>
            <p>
              <strong>{collab.replaceVoteRequest.requesterName}</strong> хочет заменить
              текущий сценарий импортированным. Одобрить?
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => collab.voteOnReplace(false)} style={{ background: "#d32f2f", color: "#fff" }}>
                Отклонить
              </button>
              <button onClick={() => collab.voteOnReplace(true)} style={{ background: "#388e3c", color: "#fff" }}>
                Одобрить
              </button>
            </div>
          </div>
        </div>
      )}

      {collab.replacePending && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "#333", color: "#fff", padding: "8px 16px", borderRadius: 8,
          fontSize: 13, zIndex: 100, pointerEvents: "none",
        }}>
          Ожидание подтверждения от участников…
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

        {[
          { type: "start",     label: "Старт" },
          { type: "final",     label: "Финал" },
          { type: "message",   label: "Сообщение" },
          { type: "input",     label: "Ввод данных" },
          { type: "condition", label: "Условие" },
          { type: "choice",    label: "Выбор варианта" },
          { type: "api",       label: "API-запрос" },
        ].map(({ type: t, label }) => (
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
            {label}
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

        {currentBotId && (
          <button
            onClick={() => {
              const url = `${window.location.origin}/?join=${currentBotId}`;
              navigator.clipboard.writeText(url).catch(() => {
                const ta = document.createElement("textarea");
                ta.value = url; document.body.appendChild(ta);
                ta.select(); document.execCommand("copy");
                document.body.removeChild(ta);
              });
              setCollabSessionId(currentBotId);
              shareSessionApi(currentBotId).catch(() => {});
              setBots((prev) => prev.map((b) => b.id === currentBotId ? { ...b, session_active: true } : b));
              showToast("Ссылка сессии скопирована", "success");
            }}
            className="mt8"
            style={{ width: "100%", marginTop: 8 }}
            title="Скопировать ссылку и открыть сессию совместного редактирования"
          >
            👥 Начать сессию
          </button>
        )}

        {!isCurrentBotOwner && currentBotId && (
          <button
            onClick={() => {
              if (isCopyingRef.current) return;
              isCopyingRef.current = true;
              copyBotApi(currentBotId)
                .then((newBot) => {
                  setBots((prev) => [newBot, ...prev]);
                  onSelectBot(newBot);
                  showToast("Копия сохранена в вашу коллекцию", "success");
                })
                .catch(() => showToast("Не удалось скопировать бота", "error"))
                .finally(() => { isCopyingRef.current = false; });
            }}
            className="mt8"
            style={{ width: "100%", marginTop: 8 }}
          >
            Копировать и сохранить
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
          paddingTop: collabSessionId ? 40 : 0,
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
          onPaneClick={onPaneClick}
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
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
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
              <strong>Глобальные переменные</strong>
              <div style={{ marginTop: 8 }}>
                {globalVariables && globalVariables.length > 0 ? (
                  globalVariables.map((v, idx) => (
                    <div key={idx} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                      <input
                        type="text"
                        placeholder="Имя"
                        value={v.name || ""}
                        onChange={(e) => {
                          const updated = [...globalVariables];
                          updated[idx] = { ...updated[idx], name: e.target.value };
                          setGlobalVariables(updated);
                        }}
                        style={{ flex: 1, minWidth: 0 }}
                      />
                      <span>=</span>
                      <input
                        type="text"
                        placeholder="Значение"
                        value={v.value || ""}
                        onChange={(e) => {
                          const updated = [...globalVariables];
                          updated[idx] = { ...updated[idx], value: e.target.value };
                          setGlobalVariables(updated);
                        }}
                        style={{ flex: 2, minWidth: 0 }}
                      />
                      <button
                        onClick={() => {
                          const updated = globalVariables.filter((_, i) => i !== idx);
                          setGlobalVariables(updated);
                        }}
                        style={{ padding: "4px 8px", background: "#d32f2f", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                      >
                        ✕
                      </button>
                    </div>
                  ))
                ) : (
                  <div style={{ color: "#777", fontStyle: "italic", marginBottom: 8 }}>Нет переменных</div>
                )}
                <button
                  onClick={() => {
                    setGlobalVariables([...(globalVariables || []), { name: "", value: "" }]);
                  }}
                  style={{ marginTop: 8, width: "100%" }}
                >
                  + Добавить переменную
                </button>
              </div>
            </label>
          </div>
        </div>
      )}

      <ChatPreview
        nodes={nodes}
        edges={edges}
        globalVariables={globalVariables && Array.isArray(globalVariables) ? globalVariables.filter((v) => v && v.name && v.name.trim()).map((v) => `${v.name.trim()}=${v.value || ""}`) : []}
      />
    </div>
  );
}