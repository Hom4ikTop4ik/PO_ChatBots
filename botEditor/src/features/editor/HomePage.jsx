import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import BotsManager from "../../components/BotsManager";
import { fetchBotsApi, createBotApi, deleteBotApi } from "../../api/botsApi";
import { toScenario } from "../../utils/scenarioUtils";

export default function HomePage() {
  const [bots, setBots] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchBotsApi()
      .then((data) => setBots(Array.isArray(data) ? data : []))
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, []);

  const handleSelectBot = (bot) => {
    navigate(`/editor/${bot.id}`); // Переход в Solo Mode
  };

  const handleNewBot = async (name) => {
    try {
      const emptyScenario = toScenario([], []);
      emptyScenario.BotName = name;
      const created = await createBotApi({ name, scenario: emptyScenario });
      navigate(`/editor/${created.id}`);
    } catch (e) {
      alert("Ошибка: " + e.message);
    }
  };

  const handleDeleteBot = async (botId) => {
    if (!window.confirm("Удалить бота?")) return;
    try {
      await deleteBotApi(botId);
      setBots((prev) => prev.filter((b) => b.id !== botId));
    } catch (e) {
      alert("Ошибка: " + e.message);
    }
  };

  return (
    <div className="app" style={{ height: "100vh" }}>
      <BotsManager
        bots={bots}
        loading={loading}
        onSelectBot={handleSelectBot}
        onNewBot={handleNewBot}
        onDeleteBot={handleDeleteBot}
      />
    </div>
  );
}
