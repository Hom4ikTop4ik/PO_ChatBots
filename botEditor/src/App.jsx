import React, { useEffect } from "react";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import LoginPage from "./auth/LoginPage";
import BotEditorShell from "./features/editor/BotEditorShell";
import "./styles/index.css";

function AppContent() {
  const { isAuthenticated, loading } = useAuth();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinId = params.get("join");
    if (joinId) {
      localStorage.setItem("pendingJoin", joinId);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  if (loading) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        Загрузка...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <BotEditorShell />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

