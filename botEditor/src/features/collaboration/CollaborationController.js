
import CollaborationBoundary from "./CollaborationBoundary";

export default class CollaborationController {
  constructor({
    scenarioId,
    callbacks = {},
  }) {
    this.scenarioId = scenarioId;
    this.callbacks = callbacks;
    this.boundary = null;
    this.connectionStatus = "idle";
    this.you = null;
    this.serverVersion = 0;
    this.pending = new Map();
    this._lastPresenceSent = "";
  }

  _emit(name, payload) {
    const fn = this.callbacks[name];
    if (typeof fn === "function") {
      try {
        fn(payload);
      } catch (e) {
        console.error("Collab callback error:", name, e);
      }
    }
  }

  start() {
    this.boundary = new CollaborationBoundary({
      scenarioId: this.scenarioId,
      onMessage: (msg) => this._handleMessage(msg),
      onStatusChange: (status) => {
        this.connectionStatus = status;
        this._emit("onStatusChange", status);
        if (status === "connected") {
          this._resync();
          this._flushPending();
        }
      },
    });
    this.boundary.connect();
  }

  stop() {
    if (this.boundary) {
      this.boundary.close();
      this.boundary = null;
    }
    this.pending.clear();
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case "snapshot": {
        this.serverVersion = msg.version || 0;
        if (msg.you) this.you = msg.you;
        this._emit("onSnapshot", {
          state: msg.state,
          version: msg.version,
          you: msg.you,
          participants: msg.participants || [],
          locks: msg.locks || [],
        });
        break;
      }
      case "op_ack": {
        this.serverVersion = msg.applied_version;
        this.pending.delete(msg.op_id);
        this._emit("onOpAccepted", {
          op_id: msg.op_id,
          applied_version: msg.applied_version,
        });
        break;
      }
      case "op_reject": {
        const entry = this.pending.get(msg.op_id);
        this.pending.delete(msg.op_id);
        this.serverVersion = msg.current_version || this.serverVersion;
        this._emit("onOpRejected", {
          op_id: msg.op_id,
          reason: msg.reason,
          op: entry ? entry.op : null,
        });
        break;
      }
      case "op_broadcast": {
        this.serverVersion = msg.applied_version;
        this._emit("onRemoteOp", {
          op: msg.op,
          applied_version: msg.applied_version,
        });
        break;
      }
      case "presence_update": {
        this._emit("onPresenceUpdate", {
          presence: msg.presence || [],
          participants: msg.participants || [],
          locks: msg.locks || [],
        });
        break;
      }
      case "lock_granted": {
        this._emit("onLockGranted", {
          block_id: msg.block_id,
          field_name: msg.field_name,
        });
        break;
      }
      case "lock_denied": {
        this._emit("onLockDenied", {
          block_id: msg.block_id,
          field_name: msg.field_name,
          locked_by: msg.locked_by,
        });
        break;
      }
      case "lock_broadcast": {
        this._emit("onLocksDelta", { added: [msg.lock] });
        break;
      }
      case "lock_release_broadcast": {
        this._emit("onLocksDelta", {
          released: [{ block_id: msg.block_id, field_name: msg.field_name }],
        });
        break;
      }
      case "ops_replay": {
        this._emit("onOpsReplay", { ops: msg.ops || [] });
        if (msg.ops && msg.ops.length > 0) {
          this.serverVersion = msg.ops[msg.ops.length - 1].applied_version;
        }
        break;
      }
      default:
        break;
    }
  }

  _flushPending() {
    for (const entry of this.pending.values()) {
      if (!entry.sent) {
        this._sendOpRaw(entry.op);
        entry.sent = true;
      }
    }
  }

  _resync() {
    if (this.boundary) {
      this.boundary.send({ type: "resync", from_version: this.serverVersion });
    }
  }

  publishOperation(operation) {
    if (!operation || !operation.op_id) return;
    this.pending.set(operation.op_id, { op: operation, sent: false });
    if (this.boundary && this.connectionStatus === "connected") {
      this._sendOpRaw(operation);
      const entry = this.pending.get(operation.op_id);
      if (entry) entry.sent = true;
    }
  }

  _sendOpRaw(operation) {
    this.boundary.send({
      type: "op",
      op_id: operation.op_id,
      op_type: operation.type,
      base_version: operation.base_version || 0,
      data: operation.data || {},
    });
  }

  requestLock(blockId, fieldName) {
    if (!this.boundary) return;
    this.boundary.send({
      type: "lock_acquire",
      block_id: blockId,
      field_name: fieldName,
    });
  }

  releaseLock(blockId, fieldName) {
    if (!this.boundary) return;
    this.boundary.send({
      type: "lock_release",
      block_id: blockId,
      field_name: fieldName,
    });
  }

  sendPresence(payload) {
    if (!this.boundary) return;
    const serialized = JSON.stringify(payload);
    if (serialized === this._lastPresenceSent) return;
    this._lastPresenceSent = serialized;
    this.boundary.send({ type: "presence", ...payload });
  }
}
