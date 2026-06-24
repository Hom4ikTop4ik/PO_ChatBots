
import React, { Fragment, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { useReactFlow } from "reactflow";
import { useCollaboration } from "./CollaborationContext";

const NODE_TYPE_STYLE = {
  start:     { background: "#e8f5e9", border: "#4caf50", borderRadius: 24 },
  final:     { background: "#fce4ec", border: "#e91e63", borderRadius: 24 },
  message:   { background: "#e3f2fd", border: "#1976d2", borderRadius: 8 },
  input:     { background: "#f3e5f5", border: "#7b1fa2", borderRadius: 8 },
  condition: { background: "#fff8e1", border: "#f57c00", borderRadius: 8 },
  choice:    { background: "#e0f7fa", border: "#0097a7", borderRadius: 8 },
  api:       { background: "#fbe9e7", border: "#bf360c", borderRadius: 8 },
};

export default function PresenceLayer({ wrapperRef, nodes = [] }) {
  const collab = useCollaboration();
  const reactFlow = useReactFlow();
  const lastSentCursorRef = useRef(0);

  useEffect(() => {
    if (!collab.enabled) return undefined;
    const wrapper = wrapperRef?.current;
    if (!wrapper) return undefined;

    const handleMove = (event) => {
      const now = performance.now();
      if (now - lastSentCursorRef.current < 50) return;
      lastSentCursorRef.current = now;
      const flowPos = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      collab.updatePresence({
        cursor: { x: flowPos.x, y: flowPos.y },
      });
    };

    wrapper.addEventListener("mousemove", handleMove);
    return () => wrapper.removeEventListener("mousemove", handleMove);
  }, [collab, reactFlow, wrapperRef]);

  if (!collab.enabled) return null;

  const myUserId = collab.you?.user_id;
  const others = collab.presence.filter((p) => p.user_id !== myUserId);
  if (others.length === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: "none",
        zIndex: 10,
      }}
    >
      {others.map((p) => {
        const participant = collab.getParticipant(p.user_id);
        if (!participant) return null;
        return (
          <Fragment key={p.user_id}>
            <GhostBlock presence={p} participant={participant} reactFlow={reactFlow} nodes={nodes} />
            <RemoteCursor presence={p} participant={participant} reactFlow={reactFlow} />
          </Fragment>
        );
      })}
    </div>
  );
}

PresenceLayer.propTypes = {
  wrapperRef: PropTypes.shape({ current: PropTypes.any }),
  nodes: PropTypes.array,
};

function RemoteCursor({ presence, participant, reactFlow }) {
  if (!presence.cursor) return null;

  let screen = { x: 0, y: 0 };
  try {
    screen = reactFlow.flowToScreenPosition({
      x: presence.cursor.x,
      y: presence.cursor.y,
    });
  } catch {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        left: screen.x,
        top: screen.y,
        transform: "translate(-2px, -2px)",
        zIndex: 11,
        pointerEvents: "none",
      }}
    >
      <svg width="20" height="20" viewBox="0 0 20 20">
        <path
          d="M2 2 L2 16 L6 12 L9 18 L11 17 L8 11 L14 11 Z"
          fill={participant.color}
          stroke="white"
          strokeWidth="1"
        />
      </svg>
      <div
        style={{
          position: "absolute",
          left: 16,
          top: 12,
          background: participant.color,
          color: "white",
          fontSize: 11,
          fontWeight: 600,
          padding: "2px 6px",
          borderRadius: 4,
          whiteSpace: "nowrap",
        }}
      >
        {participant.display_name}
      </div>
    </div>
  );
}

RemoteCursor.propTypes = {
  presence: PropTypes.object.isRequired,
  participant: PropTypes.object.isRequired,
  reactFlow: PropTypes.object.isRequired,
};

function GhostBlock({ presence, participant, reactFlow, nodes }) {
  if (!presence.dragging_block) return null;
  const { block_id, x, y } = presence.dragging_block;

  let screen;
  try {
    screen = reactFlow.flowToScreenPosition({ x, y });
  } catch {
    return null;
  }

  const node = nodes.find((n) => n.id === block_id);
  const typeStyle = NODE_TYPE_STYLE[node?.type] || { background: "#f5f5f5", border: "#999", borderRadius: 8 };
  const label = node?.data?.label || node?.type || "";
  const width = node?.width || 180;
  const height = node?.height || 56;

  return (
    <div
      style={{
        position: "fixed",
        left: screen.x,
        top: screen.y,
        width,
        height,
        background: typeStyle.background,
        border: `2px dashed ${typeStyle.border}`,
        borderRadius: typeStyle.borderRadius,
        opacity: 0.7,
        pointerEvents: "none",
        zIndex: 9,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        gap: 2,
      }}
    >
      {label && (
        <span style={{ fontSize: 11, color: typeStyle.border, fontWeight: 600, maxWidth: width - 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
      )}
      <span style={{ fontSize: 10, color: participant.color, fontWeight: 700 }}>
        {participant.display_name}
      </span>
    </div>
  );
}

GhostBlock.propTypes = {
  presence: PropTypes.object.isRequired,
  participant: PropTypes.object.isRequired,
  reactFlow: PropTypes.object.isRequired,
  nodes: PropTypes.array,
};
