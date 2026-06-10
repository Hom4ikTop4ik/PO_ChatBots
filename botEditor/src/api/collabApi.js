import { httpRequest } from "./httpClient";

// POST /api/sessions/create/{bot_id}
export function createSessionApi(botId) {
  return httpRequest(`/sessions/create/${botId}`, { method: "POST" });
}

// GET /api/sessions/{session_id}/snapshot
export function getSessionSnapshotApi(sessionId) {
  return httpRequest(`/sessions/${sessionId}/snapshot`, { method: "GET" });
}

// DELETE /api/sessions/{session_id}
export function closeSessionApi(sessionId) {
  return httpRequest(`/sessions/${sessionId}`, { method: "DELETE" });
}
