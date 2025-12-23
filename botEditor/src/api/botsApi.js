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

