import React, { useState } from "react";
import PropTypes from "prop-types";
import "./../styles/botsManager.css";

export default function BotsManager({
  bots,
  loading = false,
  onSelectBot,
  onNewBot,
  onDeleteBot,
  onJoinSession,
}) {
  const [newBotName, setNewBotName] = useState("");
  const [search, setSearch] = useState("");
  const [joinId, setJoinId] = useState("");

  const handleCreate = () => {
    const name = newBotName.trim();
    if (!name) return;
    onNewBot(name);
    setNewBotName("");
  };

  const handleDelete = (botId) => {
    onDeleteBot(botId);
  };

  const handleJoin = () => {
    let id = joinId.trim();
    const uuidMatch = id.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuidMatch) id = uuidMatch[0];
    if (!id) return;
    if (onJoinSession) onJoinSession(id);
    setJoinId("");
  };

  const handleExportBot = (bot) => {
    const scenario = bot.scenario || {};
    const fileNameBase = scenario.BotName || bot.name || "bot";
    const blob = new Blob([JSON.stringify(scenario, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileNameBase + "-bot-scenario.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const normalizedSearch = search.trim().toLowerCase();
  const visibleBots =
    normalizedSearch === ""
      ? bots
      : bots.filter((b) =>
          (b.name || "").toLowerCase().includes(normalizedSearch)
        );

  return (
    <div className="bots-manager">
      <div className="bots-manager-header">
        <h2 className="bots-manager-title">Мои боты</h2>
        <p className="bots-manager-subtitle">
          Управляйте сохранёнными сценариями, создавайте новые и экспортируйте их.
        </p>
      </div>

      <div className="bots-manager-toolbar">
        <div className="bots-manager-new">
          <input
            type="text"
            placeholder="Название нового бота"
            value={newBotName}
            onChange={(e) => setNewBotName(e.target.value)}
            className="bots-input"
          />
          <button
            onClick={handleCreate}
            className="bots-button bots-button-primary"
          >
            Создать
          </button>
        </div>

        <div className="bots-manager-search">
          <input
            type="text"
            placeholder="Поиск бота по имени"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bots-input bots-input-search"
          />
        </div>
      </div>

      {/* Совместная работа: вход в чужую сессию по ID (Vision §3.1) */}
      <div
        style={{
          padding: "12px 16px",
          margin: "0 16px 16px",
          background: "#f0f7ff",
          border: "1px solid #cfe2ff",
          borderRadius: 6,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          🤝 Присоединиться к сессии совместного редактирования
        </div>
        <div style={{ fontSize: 12, color: "#555", marginBottom: 8 }}>
          Вставьте ID сессии, который дал вам владелец бота, чтобы открыть
          сценарий и редактировать его вместе.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            placeholder="UUID сценария, например 4f3a..."
            value={joinId}
            onChange={(e) => setJoinId(e.target.value)}
            className="bots-input"
            style={{ flex: 1 }}
          />
          <button
            onClick={handleJoin}
            className="bots-button bots-button-primary"
            disabled={!joinId.trim()}
          >
            Присоединиться
          </button>
        </div>
      </div>

      <div className="bots-manager-content">
        {loading ? (
          <div className="bots-empty bots-empty-muted">
            Загружаем список ботов...
          </div>
        ) : visibleBots.length === 0 ? (
          <div className="bots-empty">
            <div className="bots-empty-title">
              Боты ещё не созданы или ничего не найдено.
            </div>
            <div className="bots-empty-text">
              Попробуйте изменить условия поиска или создайте нового бота.
            </div>
          </div>
        ) : (
          <ul className="bots-list">
            {visibleBots.map((bot) => (
              <li key={bot.id} className="bots-item">
                <div className="bots-item-main">
                  <div className="bots-item-name">
                    {bot.name}
                    {bot.session_active && (
                      <span style={{ marginLeft: 6, fontSize: 11, color: "#5cb85c", fontWeight: 600 }}>● сессия</span>
                    )}
                  </div>
                  {bot.owner_email && (
                    <div className="bots-item-meta" style={{ color: "#888" }}>
                      👤 {bot.owner_email}
                    </div>
                  )}
                  <div className="bots-item-meta">ID: {bot.id}</div>
                </div>
                <div className="bots-item-actions">
                  <button
                    onClick={() => onSelectBot(bot)}
                    className="bots-button bots-button-primary"
                  >
                    Открыть
                  </button>
                  <button
                    onClick={() => handleExportBot(bot)}
                    className="bots-button bots-button-secondary"
                  >
                    Экспорт
                  </button>
                  {bot.is_owner !== false && (
                    <button
                      onClick={() => handleDelete(bot.id)}
                      className="bots-button bots-button-danger"
                    >
                      Удалить
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

BotsManager.propTypes = {
  bots: PropTypes.array.isRequired,
  loading: PropTypes.bool,
  onSelectBot: PropTypes.func.isRequired,
  onNewBot: PropTypes.func.isRequired,
  onDeleteBot: PropTypes.func.isRequired,
  onJoinSession: PropTypes.func,
};
