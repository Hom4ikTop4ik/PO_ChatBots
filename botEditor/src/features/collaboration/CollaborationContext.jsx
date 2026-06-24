
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import PropTypes from "prop-types";
import CollaborationController from "./CollaborationController";

const CollaborationContext = createContext(null);

export function CollaborationProvider({
  scenarioId,
  onSnapshot,
  onRemoteOp,
  onOpAccepted,
  onOpRejected,
  onOpsReplay,
  onReplaceApplied,
  onReplaceRejected,
  children,
}) {
  const controllerRef = useRef(null);
  const [status, setStatus] = useState("idle");
  const [you, setYou] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [locks, setLocks] = useState([]);
  const [presence, setPresence] = useState([]);
  const [pendingLocks, setPendingLocks] = useState([]);
  const [replaceVoteRequest, setReplaceVoteRequest] = useState(null);
  const [replacePending, setReplacePending] = useState(false);
  const callbacksRef = useRef({});
  callbacksRef.current = { onSnapshot, onRemoteOp, onOpAccepted, onOpRejected, onOpsReplay, onReplaceApplied, onReplaceRejected };

  useEffect(() => {
    if (!scenarioId) {
      setStatus("idle");
      return undefined;
    }

    const controller = new CollaborationController({
      scenarioId,
      callbacks: {
        onStatusChange: (s) => setStatus(s),
        onSnapshot: ({ state, version, you: y, participants: parts, locks: lks }) => {
          if (y) setYou(y);
          setParticipants(parts);
          setLocks(lks);
          if (callbacksRef.current.onSnapshot) {
            callbacksRef.current.onSnapshot({ state, version });
          }
        },
        onPresenceUpdate: ({ presence: p, participants: parts, locks: lks }) => {
          if (Array.isArray(p)) setPresence(p);
          if (Array.isArray(parts)) setParticipants(parts);
          if (Array.isArray(lks)) setLocks(lks);
        },
        onLocksDelta: ({ added, released }) => {
          setLocks((prev) => {
            let next = prev;
            if (added) {
              const seen = new Set(prev.map((l) => `${l.block_id}|${l.field_name}`));
              for (const a of added) {
                const key = `${a.block_id}|${a.field_name}`;
                if (seen.has(key)) {
                  next = next.map((l) =>
                    l.block_id === a.block_id && l.field_name === a.field_name ? a : l
                  );
                } else {
                  next = [...next, a];
                }
              }
            }
            if (released) {
              for (const r of released) {
                next = next.filter(
                  (l) => !(l.block_id === r.block_id && l.field_name === r.field_name)
                );
              }
            }
            return next;
          });
        },
        onLockGranted: ({ block_id, field_name, locked_by }) => {
          setPendingLocks((prev) =>
            prev.filter((l) => !(l.block_id === block_id && l.field_name === field_name))
          );
          setLocks((prev) => {
            const exists = prev.some(
              (l) => l.block_id === block_id && l.field_name === field_name
            );
            if (exists) return prev;
            return [
              ...prev,
              {
                block_id,
                field_name,
                locked_by,
                acquired_at: new Date().toISOString(),
              },
            ];
          });
        },
        onLockDenied: ({ block_id, field_name }) => {
          setPendingLocks((prev) =>
            prev.filter((l) => !(l.block_id === block_id && l.field_name === field_name))
          );
        },
        onOpAccepted: (info) => {
          if (callbacksRef.current.onOpAccepted) callbacksRef.current.onOpAccepted(info);
        },
        onOpRejected: (info) => {
          if (callbacksRef.current.onOpRejected) callbacksRef.current.onOpRejected(info);
        },
        onRemoteOp: (info) => {
          if (callbacksRef.current.onRemoteOp) callbacksRef.current.onRemoteOp(info);
        },
        onOpsReplay: (info) => {
          if (callbacksRef.current.onOpsReplay) callbacksRef.current.onOpsReplay(info);
        },
        onReplaceVoteRequest: ({ requesterName }) => setReplaceVoteRequest({ requesterName }),
        onReplacePending: () => setReplacePending(true),
        onReplaceApplied: () => {
          setReplacePending(false);
          setReplaceVoteRequest(null);
          if (callbacksRef.current.onReplaceApplied) callbacksRef.current.onReplaceApplied();
        },
        onReplaceRejected: (info) => {
          setReplacePending(false);
          if (callbacksRef.current.onReplaceRejected) callbacksRef.current.onReplaceRejected(info);
        },
        onReplaceCancelled: () => setReplaceVoteRequest(null),
      },
    });

    controllerRef.current = controller;
    controller.start();

    return () => {
      controller.stop();
      controllerRef.current = null;
      setParticipants([]);
      setLocks([]);
      setPresence([]);
      setPendingLocks([]);
      setYou(null);
    };
  }, [scenarioId]);

  const publishOperation = useCallback((operation) => {
    if (controllerRef.current) controllerRef.current.publishOperation(operation);
  }, []);

  const acquireLock = useCallback((blockId, fieldName) => {
    if (!controllerRef.current) return;
    setPendingLocks((prev) => {
      const exists = prev.some(
        (l) => l.block_id === blockId && l.field_name === fieldName
      );
      if (exists) return prev;
      return [...prev, { block_id: blockId, field_name: fieldName }];
    });
    controllerRef.current.requestLock(blockId, fieldName);
  }, []);

  const releaseLock = useCallback((blockId, fieldName) => {
    if (!controllerRef.current) return;
    controllerRef.current.releaseLock(blockId, fieldName);
    setLocks((prev) =>
      prev.filter((l) => !(l.block_id === blockId && l.field_name === fieldName))
    );
  }, []);

  const updatePresence = useCallback((payload) => {
    if (controllerRef.current) controllerRef.current.sendPresence(payload);
  }, []);

  const requestReplace = useCallback((state) => {
    if (controllerRef.current) controllerRef.current.sendReplaceRequest(state);
  }, []);

  const voteOnReplace = useCallback((approved) => {
    if (controllerRef.current) controllerRef.current.sendReplaceVote(approved);
    setReplaceVoteRequest(null);
  }, []);

  const getFieldLock = useCallback(
    (blockId, fieldName) => {
      return (
        locks.find(
          (l) => l.block_id === blockId && l.field_name === fieldName
        ) || null
      );
    },
    [locks]
  );

  const isFieldLockedByOther = useCallback(
    (blockId, fieldName) => {
      const lock = locks.find(
        (l) => l.block_id === blockId && l.field_name === fieldName
      );
      if (!lock) return null;
      if (you && lock.locked_by === you.user_id) return null;
      return lock;
    },
    [locks, you]
  );

  const isFieldPending = useCallback(
    (blockId, fieldName) => {
      return pendingLocks.some(
        (l) => l.block_id === blockId && l.field_name === fieldName
      );
    },
    [pendingLocks]
  );

  const getParticipant = useCallback(
    (userId) => participants.find((p) => p.user_id === userId) || null,
    [participants]
  );

  const value = useMemo(
    () => ({
      enabled: Boolean(scenarioId),
      status,
      you,
      participants,
      locks,
      presence,
      publishOperation,
      acquireLock,
      releaseLock,
      updatePresence,
      getFieldLock,
      isFieldLockedByOther,
      isFieldPending,
      getParticipant,
      replaceVoteRequest,
      replacePending,
      requestReplace,
      voteOnReplace,
    }),
    [
      scenarioId,
      status,
      you,
      participants,
      locks,
      presence,
      publishOperation,
      acquireLock,
      releaseLock,
      updatePresence,
      getFieldLock,
      isFieldLockedByOther,
      isFieldPending,
      getParticipant,
      replaceVoteRequest,
      replacePending,
      requestReplace,
      voteOnReplace,
    ]
  );

  return (
    <CollaborationContext.Provider value={value}>{children}</CollaborationContext.Provider>
  );
}

CollaborationProvider.propTypes = {
  scenarioId: PropTypes.string,
  onSnapshot: PropTypes.func,
  onRemoteOp: PropTypes.func,
  onOpAccepted: PropTypes.func,
  onOpRejected: PropTypes.func,
  onOpsReplay: PropTypes.func,
  onReplaceApplied: PropTypes.func,
  onReplaceRejected: PropTypes.func,
  children: PropTypes.node,
};


export function useCollaboration() {
  const ctx = useContext(CollaborationContext);
  if (!ctx) {
    return {
      enabled: false,
      status: "idle",
      you: null,
      participants: [],
      locks: [],
      presence: [],
      publishOperation: () => {},
      acquireLock: () => {},
      releaseLock: () => {},
      updatePresence: () => {},
      getFieldLock: () => null,
      isFieldLockedByOther: () => null,
      isFieldPending: () => false,
      getParticipant: () => null,
    };
  }
  return ctx;
}
