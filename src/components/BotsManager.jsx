import React, { useState, useRef } from "react";
// TODO: добавить проверку типов
// TODO: стилизовать под остальной интерфейс
// TODO: добавить подтверждение при удалении бота
// TODO: уйти с локального состояния на управление ботами через глобальный стейт или контекст
// TODO: добавить складывание ботов вместо локального хранилища в бд

export default function BotsManager({ bots, setBots, onSelectBot, onNewBot }) {
  const [newBotName, setNewBotName] = useState("");
  const [search, setSearch] = useState("");

  const fileInputRef = useRef(null);

  const handleCreate = () => {
    const name = newBotName.trim();
    if (!name) return;
    onNewBot(name);
    setNewBotName("");
  };

  const handleDelete = (botId) => {
    const ok = window.confirm("Удалить бота и его bot_model из списка?");
    if (!ok) return;
    setBots((bs) => bs.filter((b) => b.id !== botId));
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
        const parsed = JSON.parse(reader.result);

        const mkBot = (scenarioLike, idx) => {
          const scenario = scenarioLike.scenario || scenarioLike;
          const baseName =
            scenario.BotName ||
            scenarioLike.name ||
            `Импортированный бот ${idx + 1}`;
          const id = crypto.randomUUID();
          return { id, name: baseName, scenario };
        };

        let importedBots = [];
        if (Array.isArray(parsed)) {
          importedBots = parsed.map((item, idx) => mkBot(item, idx));
        } else {
          importedBots = [mkBot(parsed, 0)];
        }

        setBots((prev) => [...prev, ...importedBots]);
        alert("Бот(ы) успешно импортированы.");
      } catch (e) {
        alert("Ошибка импорта: " + e.message);
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const normalizedSearch = search.trim().toLowerCase();
  const visibleBots =
    normalizedSearch === ""
      ? bots
      : bots.filter((b) =>
          (b.name || "").toLowerCase().includes(normalizedSearch)
        );

  return (
    <div style={{ padding: 20 }}>
      <h2>Управление ботами</h2>

      <div style={{ marginBottom: 12 }}>
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
        <button
          onClick={handleImportClick}
          style={{ marginLeft: 8, padding: "6px 12px" }}
        >
          Импортировать бота
        </button>
        <input
          type="file"
          accept="application/json"
          ref={fileInputRef}
          onChange={handleFileChange}
          style={{ display: "none" }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
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

      {visibleBots.length === 0 ? (
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
