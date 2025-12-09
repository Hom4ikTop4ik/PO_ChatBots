const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

export async function httpRequest(path, { method = "GET", body } = {}) {
  const url = `${API_BASE_URL}${path}`;

  const init = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  };

  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url, init);

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data && data.error) {
        message = data.error;
      }
    } catch (e) {
    }
    throw new Error(message);
  }

  if (res.status === 204) {
    return null;
  }

  return res.json();
}

export default httpRequest;

