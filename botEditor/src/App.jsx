import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import LoginPage from "./auth/LoginPage";
import HomePage from "./features/editor/HomePage";
import BotEditorShell from "./features/editor/BotEditorShell";
import ConnectPage from "./features/editor/ConnectPage";
import "./styles/index.css";

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>Загрузка...</div>;
  if (!isAuthenticated) return <LoginPage />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          
          {/* Главная страница (Список ботов) */}
          <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
          
          {/* Редактор бота (Solo Mode) */}
          <Route path="/editor/:botId" element={<ProtectedRoute><BotEditorShell /></ProtectedRoute>} />
          
          {/* Заглушки для будущих шагов */}
          <Route path="/connect/:sessionId" element={<ProtectedRoute><ConnectPage /></ProtectedRoute>} />
          <Route path="/collab/:sessionId" element={<ProtectedRoute><BotEditorShell /></ProtectedRoute>} />
          
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
