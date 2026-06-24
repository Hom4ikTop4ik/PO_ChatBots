import React, { useRef, useCallback } from "react";
import ReactFlow, { MiniMap, Controls, Background } from "reactflow";
import "reactflow/dist/style.css";
import { createDefaultDataForType } from "../utils/scenarioUtils";
import {
  createBlockAddOp,
  createEdgeUpdateOp,
} from "../features/editor/operations";
import PropTypes from "prop-types";
import {
  PresenceLayer,
  useCollaboration,
} from "../features/collaboration";

export default function Canvas({
  nodes,
  edges,
  nodeTypes,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeClick,
  onNodeContextMenu,
  onEdgeContextMenu,
  onEdgeDoubleClick,
  onNodesDelete,
  onEdgesDelete,
  dispatchOperation,
  getCurrentVersion,
  onPaneClick,
  editingEdgeId,
  setEditingEdgeId,
}) {
  const reactFlowWrapper = useRef(null);
  const reactFlowInstance = useRef(null);
  const collab = useCollaboration();

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/reactflow");
      if (!type) return;
      const instance = reactFlowInstance.current;
      const position = instance
        ? instance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
        : { x: event.clientX, y: event.clientY };

      const id = crypto.randomUUID();
      const data = createDefaultDataForType(type);
      const newNode = { id, type, position, data };
      dispatchOperation(createBlockAddOp(newNode, getCurrentVersion()));
    },
    [dispatchOperation, getCurrentVersion]
  );

  // Аннотируем чужие выделения цветом владельца (Vision §3.1):
  // подмешиваем CSS-переменную/border, не ломая существующую логику.
  const annotatedNodes = React.useMemo(() => {
    if (!collab.enabled) return nodes;
    const myUserId = collab.you?.user_id;
    const selectionByBlock = new Map();
    for (const p of collab.presence) {
      if (p.user_id === myUserId) continue;
      if (p.selected_block_id) {
        const participant = collab.getParticipant(p.user_id);
        if (participant) selectionByBlock.set(p.selected_block_id, participant);
      }
    }
    return nodes.map((n) => {
      const owner = selectionByBlock.get(n.id);
      const lockedByOther = collab.locks.some(
        (l) => l.block_id === n.id && l.locked_by !== myUserId
      );
      const blockedByOther = lockedByOther || !!owner;
      if (!blockedByOther) return n;
      return {
        ...n,
        draggable: false,
        style: owner
          ? { ...(n.style || {}), boxShadow: `0 0 0 3px ${owner.color}`, borderRadius: 6 }
          : (n.style || {}),
      };
    });
  }, [nodes, collab]);

  return (
    <>
      <div
        className="content"
        ref={reactFlowWrapper}
        onDrop={onDrop}
        onDragOver={onDragOver}
        style={{
          width: "100%",
          height: "100%",
          flex: 1,
          position: "relative",
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <ReactFlow
          style={{ width: "100%", height: "100%" }}
          nodes={annotatedNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onNodeContextMenu={onNodeContextMenu}
          onEdgeContextMenu={onEdgeContextMenu}
          onEdgeDoubleClick={onEdgeDoubleClick}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          onPaneClick={onPaneClick}
          onInit={(instance) => {
            reactFlowInstance.current = instance;
          }}
          fitView
        >
          <MiniMap />
          <Controls />
          <Background variant="dots" gap={16} size={1} />
        </ReactFlow>

        {/* Presence-оверлей: курсоры других участников (Vision §3.1) */}
        <PresenceLayer wrapperRef={reactFlowWrapper} nodes={nodes} />
      </div>

      {editingEdgeId && (
        <div className="modal-overlay" onClick={() => setEditingEdgeId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Редактирование соединения</h3>
            <p className="muted">
              Выберите новый целевой узел для этого соединения:
            </p>

            <div className="edge-list">
              {nodes.map((node) => {
                const edge = edges.find((e) => e.id === editingEdgeId);
                return (
                  <button
                    key={node.id}
                    onClick={() => {
                      dispatchOperation(
                        createEdgeUpdateOp(
                          editingEdgeId,
                          { target: node.id },
                          getCurrentVersion()
                        )
                      );
                      setEditingEdgeId(null);
                    }}
                    className={`edge-target-button ${
                      edge?.target === node.id ? "selected" : ""
                    }`}
                  >
                    {node.data.label || node.id} ({node.type})
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setEditingEdgeId(null)}
              className="btn-cancel"
            >
              Отмена
            </button>
          </div>
        </div>
      )}
    </>
  );
}

Canvas.propTypes = {
  nodes: PropTypes.array.isRequired,
  edges: PropTypes.array.isRequired,
  nodeTypes: PropTypes.object.isRequired,
  onNodesChange: PropTypes.func.isRequired,
  onEdgesChange: PropTypes.func.isRequired,
  onConnect: PropTypes.func.isRequired,
  onNodeClick: PropTypes.func.isRequired,
  onNodeContextMenu: PropTypes.func.isRequired,
  onEdgeContextMenu: PropTypes.func.isRequired,
  onEdgeDoubleClick: PropTypes.func.isRequired,
  onNodesDelete: PropTypes.func.isRequired,
  onEdgesDelete: PropTypes.func.isRequired,
  dispatchOperation: PropTypes.func.isRequired,
  getCurrentVersion: PropTypes.func.isRequired,
  onPaneClick: PropTypes.func,
  editingEdgeId: PropTypes.string,
  setEditingEdgeId: PropTypes.func.isRequired,
};
