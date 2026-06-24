import { httpRequest } from "./httpClient";

// GET /api/bots
export function fetchBotsApi() {
  return httpRequest("/bots", { method: "GET" });
}

// POST /api/bots
export function createBotApi({ name, scenario }) {
  return httpRequest("/bots", {
    method: "POST",
    body: { name, scenario },
  });
}

// PUT /api/bots/:id
export function updateBotApi({ id, name, scenario }) {
  return httpRequest(`/bots/${id}`, {
    method: "PUT",
    body: { name, scenario },
  });
}

// DELETE /api/bots/:id
export function deleteBotApi(id) {
  return httpRequest(`/bots/${id}`, {
    method: "DELETE",
  });
}

// POST /api/bots/copy/:sourceId
export function copyBotApi(sourceId) {
  return httpRequest(`/bots/copy/${sourceId}`, { method: "POST" });
}

// PUT /api/bots/:id/collab-save (no ownership check)
export function collabSaveBotApi({ id, name, scenario }) {
  return httpRequest(`/bots/${id}/collab-save`, {
    method: "PUT",
    body: { name, scenario },
  });
}

// POST /api/bots/:id/access — record that the current user joined this bot
export function recordBotAccessApi(botId) {
  return httpRequest(`/bots/${botId}/access`, { method: "POST" });
}

// POST /api/bots/:id/share-session — mark bot's session as shared (owner only)
export function shareSessionApi(botId) {
  return httpRequest(`/bots/${botId}/share-session`, { method: "POST" });
}

