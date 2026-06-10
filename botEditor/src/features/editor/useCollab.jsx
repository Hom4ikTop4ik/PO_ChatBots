import { useEffect, useRef, useState } from 'react';
import ReconnectingWebSocket from 'reconnecting-websocket';

import { API_BASE_URL } from '../../config';

// 1. ЗАМЕНА: botId на sessionId, добавили onSessionClosed
export function useCollab(sessionId, onRemoteOperation, onAck, onSessionClosed) {
  const wsRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!sessionId) return; // Если sessionId нет (Solo Mode) - ничего не делаем

    let isSubscribed = true;

    const initConnection = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/auth/ws-token`, { credentials: 'include' });
        if (!res.ok) throw new Error("Failed to get WS token");
        const { token } = await res.json();

        if (!isSubscribed) return;

        const WS_BASE = API_BASE_URL.replace(/^http/, 'ws');
        
        // 2. ЗАМЕНА: Путь теперь использует sessionId
        const wsUrl = `${WS_BASE}/collab/ws/${sessionId}?token=${token}`;

        const rws = new ReconnectingWebSocket(wsUrl);
        wsRef.current = rws;

        rws.addEventListener('open', () => {
          console.log("[Collab] Connected to session:", sessionId);
          setIsConnected(true);
        });

        rws.addEventListener('close', () => setIsConnected(false));

        rws.addEventListener('message', (e) => {
          const msg = JSON.parse(e.data);
          if (msg.type === 'op_broadcast') onRemoteOperation(msg.operation);
          else if (msg.type === 'op_ack') onAck(msg.op_id, msg.new_version);
          else if (msg.type === 'op_reject') console.warn("[Collab] Rejected:", msg.reason);
          // 3. НОВОЕ: Обработка закрытия сессии
          else if (msg.type === 'session_closed' && onSessionClosed) onSessionClosed();
        });

      } catch (err) {
        console.error("[Collab] Connection error:", err);
      }
    };

    initConnection();

    return () => {
      isSubscribed = false;
      if (wsRef.current) wsRef.current.close();
    };
  }, [sessionId, onRemoteOperation, onAck, onSessionClosed]);

  const sendOperation = (operation) => {
    if (wsRef.current && isConnected) {
      wsRef.current.send(JSON.stringify({ type: 'op', operation }));
    }
  };

  return { isConnected, sendOperation };
}
