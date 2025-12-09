import React, { useState } from "react";

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
    <div style={{ padding: 20, width: "100%" }}>
      <h2>Мои боты</h2>

      <div style={{ marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Название нового бота"
          value={newBotName}
          onChange={(e) => setNewBotName(e.target.value)}
          style={{
            padding: 6,
            borderRadius: 4,
            border: "1px solid #ccc",
          }}
        />
        <button
          onClick={handleCreate}
          style={{ marginLeft: 8, padding: "6px 12px" }}
        >
          Создать
        </button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Поиск бота по имени"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: 6,
            borderRadius: 4,
            border: "1px solid #ccc",
            width: 260,
          }}
        />
      </div>

      {loading ? (
        <p>Загружаем список ботов...</p>
      ) : visibleBots.length === 0 ? (
        <p>Боты ещё не созданы или ничего не найдено.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {visibleBots.map((bot) => (
            <li
              key={bot.id}
              style={{
                marginBottom: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <strong>{bot.name}</strong>
                <div style={{ fontSize: 12, color: "#555" }}>ID: {bot.id}</div>
              </div>
              <div style={{ marginLeft: 40 }}>
                <button
                  onClick={() => onSelectBot(bot)}
                  style={{ marginRight: 8, padding: "6px 10px" }}
                >
                  Открыть
                </button>
                <button
                  onClick={() => handleExportBot(bot)}
                  style={{ marginRight: 8, padding: "6px 10px" }}
                >
                  Экспорт
                </button>
                <button
                  onClick={() => handleDelete(bot.id)}
                  style={{ padding: "6px 10px" }}
                >
                  Удалить
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

