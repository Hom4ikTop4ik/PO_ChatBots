import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { fetchCurrentUser, loginApi, registerApi, logoutApi } from "../api/authApi";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const me = await fetchCurrentUser();
        if (!cancelled) {
          setUser(me);
        }
      } catch (e) {
        if (!cancelled) {
          setUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async ({ email, password }) => {
    await loginApi({ email, password });
    const me = await fetchCurrentUser();
    setUser(me);
  }, []);

  const register = useCallback(async ({ email, password }) => {
    await registerApi({ email, password });
    const me = await fetchCurrentUser();
    setUser(me);
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutApi();
    } catch (e) {
    }
    setUser(null);
  }, []);

  const value = {
    user,
    loading,
    login,
    register,
    logout,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

