import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

export default function ConnectPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (sessionId) {
      // Честный редирект в Collab Mode
      navigate(`/collab/${sessionId}`, { replace: true });
    } else {
      navigate('/');
    }
  }, [sessionId, navigate]);

  return (
    <div style={{ padding: 20, textAlign: 'center', fontFamily: 'sans-serif' }}>
      <h2>Инициализация подключения...</h2>
    </div>
  );
}
