import React, { useState } from "react";
import PropTypes from "prop-types";
import { useCollaboration } from "./CollaborationContext";

const STATUS_LABELS = {
  idle: { text: "Локальный режим", color: "#999" },
  connecting: { text: "Подключение…", color: "#f0ad4e" },
  connected: { text: "Совместная работа", color: "#5cb85c" },
  disconnected: { text: "Связь потеряна", color: "#d9534f" },
  error: { text: "Ошибка соединения", color: "#d9534f" },
};

export default function ParticipantsBar({ scenarioId }) {
  const collab = useCollaboration();
  const [showShare, setShowShare] = useState(false);

  if (!collab.enabled) {
    return (
      <div className="participants-bar" style={barStyle}>
        <span style={{ color: "#999", fontSize: 12 }}>
          Сохраните бота, чтобы открыть сессию совместной работы
        </span>
      </div>
    );
  }

  const status = STATUS_LABELS[collab.status] || STATUS_LABELS.idle;
  const sortedParticipants = [...collab.participants].sort(
    (a, b) => (a.status === b.status ? 0 : a.status === "active" ? -1 : 1)
  );

  const handleCopy = async () => {
    if (!scenarioId) return;
    try {
      await navigator.clipboard.writeText(scenarioId);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = scenarioId;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setShowShare(true);
    setTimeout(() => setShowShare(false), 1500);
  };

  return (
    <div className="participants-bar" style={barStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: status.color,
            display: "inline-block",
          }}
        />
        <span style={{ fontSize: 12, color: "#444" }}>{status.text}</span>
      </div>

      <div style={{ display: "flex", gap: 4, marginLeft: 12 }}>
        {sortedParticipants.map((p) => (
          <Avatar key={p.user_id} participant={p} isMe={collab.you?.user_id === p.user_id} />
        ))}
      </div>

      <button
        type="button"
        onClick={handleCopy}
        style={{
          marginLeft: "auto",
          fontSize: 11,
          background: "#fff",
          border: "1px solid #ccc",
          padding: "4px 8px",
          borderRadius: 4,
          cursor: "pointer",
        }}
        title="Скопировать ID сессии — отдайте его другому, чтобы он мог присоединиться"
      >
        {showShare ? "✓ Скопировано" : "🔗 Скопировать ID"}
      </button>
    </div>
  );
}

ParticipantsBar.propTypes = {
  scenarioId: PropTypes.string,
};

function Avatar({ participant, isMe }) {
  const initials = (participant.display_name || "?")
    .slice(0, 2)
    .toUpperCase();
  const isDisconnected = participant.status === "disconnected";
  return (
    <div
      title={`${participant.display_name}${isMe ? " (вы)" : ""}${
        isDisconnected ? " — отключён" : ""
      }`}
      style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: isDisconnected ? "#bbb" : participant.color,
        color: "white",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 11,
        fontWeight: 700,
        border: isMe ? "2px solid #1976d2" : "2px solid white",
        boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
        opacity: isDisconnected ? 0.6 : 1,
      }}
    >
      {initials}
    </div>
  );
}

Avatar.propTypes = {
  participant: PropTypes.object.isRequired,
  isMe: PropTypes.bool,
};

const barStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  background: "#fafafa",
  borderBottom: "1px solid #e0e0e0",
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  zIndex: 30,
  height: 40,
  boxSizing: "border-box",
};
