import { httpRequest } from "./httpClient";

// POST /api/auth/login
export function loginApi({ email, password }) {
  return httpRequest("/auth/login", {
    method: "POST",
    body: { email, password },
  });
}

// POST /api/auth/register
export function registerApi({ email, password }) {
  return httpRequest("/auth/register", {
    method: "POST",
    body: { email, password },
  });
}

// GET /api/auth/me
export function fetchCurrentUser() {
  return httpRequest("/auth/me", { method: "GET" });
}

// POST /api/auth/logout
export function logoutApi() {
  return httpRequest("/auth/logout", { method: "POST" });
}

