import React, { useState } from "react";
import PropTypes from "prop-types";
import "./../styles/botsManager.css";

export default function BotsManager({
  bots,
  loading = false,
  onSelectBot,
  onNewBot,
  onDeleteBot,
}) {
  const [newBotName, setNewBotName] = useState("");
  const [search, setSearch] = useState("");

  const handleCreate = () => {
    const name = newBotName.trim();
    if (!name) return;
    onNewBot(name);
    setNewBotName("");
  };

  const handleDelete = (botId) => {
    onDeleteBot(botId);
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
                  <div className="bots-item-name">{bot.name}</div>
                  <div className="bots-item-meta">ID: {bot.id}</div>
                  {bot.scenario?.BotName && (
                    <div className="bots-item-meta bots-item-meta-light">
                      В сценарии: {bot.scenario.BotName}
                    </div>
                  )}
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
                  <button
                    onClick={() => handleDelete(bot.id)}
                    className="bots-button bots-button-danger"
                  >
                    Удалить
                  </button>
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
};
