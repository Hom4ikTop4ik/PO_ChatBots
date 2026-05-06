import { httpRequest } from "../../api/httpClient";

export function fetchCollabScenarioMeta(botId) {
  return httpRequest(`/collab/scenarios/${botId}`, { method: "GET" });
}
