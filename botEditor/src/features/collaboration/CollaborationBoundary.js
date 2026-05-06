const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";

function deriveWsBase() {
  try {
    const u = new URL(API_BASE_URL, globalThis.location?.href || "http://localhost");
    const proto = u.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${u.host}`;
  } catch {
    return "ws://localhost:8000";
  }
}

const WS_BASE = deriveWsBase();
const RECONNECT_DELAY_MS = 1500;
const MAX_RECONNECT_DELAY_MS = 15000;

export default class CollaborationBoundary {
  constructor({ scenarioId, onMessage, onStatusChange }) {
    this.scenarioId = scenarioId;
    this.onMessage = onMessage;
    this.onStatusChange = onStatusChange || (() => {});
    this.ws = null;
    this.reconnectAttempts = 0;
    this.intentionallyClosed = false;
    this.queue = [];
  }

  _setStatus(status) {
    this.onStatusChange(status);
  }

  connect() {
    this.intentionallyClosed = false;
    const url = `${WS_BASE}/ws/collab/${this.scenarioId}`;
    this._setStatus("connecting");

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this._setStatus("error");
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this._setStatus("connected");
      while (this.queue.length > 0) {
        const msg = this.queue.shift();
        try {
          ws.send(JSON.stringify(msg));
        } catch {
          this.queue.unshift(msg);
          break;
        }
      }
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      try {
        this.onMessage(msg);
      } catch (e) {
        console.error("Collaboration message handler error", e);
      }
    };

    ws.onclose = () => {
      this.ws = null;
      this._setStatus("disconnected");
      if (!this.intentionallyClosed) {
        const delay = Math.min(
          RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts),
          MAX_RECONNECT_DELAY_MS
        );
        this.reconnectAttempts += 1;
        setTimeout(() => {
          if (!this.intentionallyClosed) this.connect();
        }, delay);
      }
    };

    ws.onerror = () => {
      this._setStatus("error");
    };
  }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message));
      } catch {
        this.queue.push(message);
      }
    } else {
      this.queue.push(message);
    }
  }

  close() {
    this.intentionallyClosed = true;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
      }
      this.ws = null;
    }
    this.queue = [];
  }
}
