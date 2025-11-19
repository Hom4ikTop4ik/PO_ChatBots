import React, { useState } from "react";
// TODO: добавить проверку типов
// TODO: стилизовать под остальной интерфейс
// TODO: добавить подтверждение при удалении бота
// TODO: добавить поиск по списку ботов
// TODO: уйти с локального состояния на управление ботами через глобальный стейт или контекст
// TODO: добавить кнопку импрорта/экспорта ботов
// TODO: добавить складывание ботов вместо локального хранилища в бд
export default function BotsManager({ bots, setBots, onSelectBot, onNewBot }) {
  const [newBotName, setNewBotName] = useState("");
  const handleCreate = () => {
    const name = newBotName.trim();
    if (!name) return;
    onNewBot(name);
    setNewBotName("");
  };
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
            marginRight: 8,
            borderRadius: 4,
            border: "1px solid #ccc",
          }}
        />
        <button onClick={handleCreate} style={{ padding: "6px 12px" }}>
          Создать
        </button>
      </div>
      {bots.length === 0 ? (
        <p>Боты ещё не созданы.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {bots.map((bot) => (
            <li
              key={bot.id}
              style={{
                padding: 8,
                marginBottom: 8,
                border: "1px solid #e0e0e0",
                borderRadius: 6,
                background: "#fafafa",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <strong>{bot.name}</strong>
                <div style={{ fontSize: 12, color: "#555" }}>ID: {bot.id}</div>
              </div>
              <div>
                <button
                  onClick={() => onSelectBot(bot)}
                  style={{ marginRight: 8, padding: "6px 10px" }}
                >
                  Открыть
                </button>
                <button
                  onClick={() => {
                    const ok = window.confirm("Удалить бота?");
                    if (ok) {
                      setBots((bs) => bs.filter((b) => b.id !== bot.id));
                    }
                  }}
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
