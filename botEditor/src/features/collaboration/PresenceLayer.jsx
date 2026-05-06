
import React, { useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { useReactFlow } from "reactflow";
import { useCollaboration } from "./CollaborationContext";

export default function PresenceLayer({ wrapperRef }) {
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
          <RemoteCursor
            key={p.user_id}
            presence={p}
            participant={participant}
            reactFlow={reactFlow}
          />
        );
      })}
    </div>
  );
}

PresenceLayer.propTypes = {
  wrapperRef: PropTypes.shape({ current: PropTypes.any }),
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
