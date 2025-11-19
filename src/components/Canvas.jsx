import React, { useRef, useCallback } from "react";
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
} from "reactflow";
import "reactflow/dist/style.css";
import { createDefaultDataForType } from "../utils/scenarioUtils";


// TODO: добавить проверку типов
function Canvas({
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
  setNodes,
  setEdges,
  editingEdgeId,
  setEditingEdgeId,
}) {
  const reactFlowWrapper = useRef(null);
  const reactFlowInstance = useRef(null);

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/reactflow");
      if (!type) return;

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const instance = reactFlowInstance.current;
      const position = instance
        ? instance.project({
            x: event.clientX - bounds.left,
            y: event.clientY - bounds.top,
          })
        : { x: event.clientX - bounds.left, y: event.clientY - bounds.top };

      const id = crypto.randomUUID();
      const data = createDefaultDataForType(type);
      const newNode = {
        id,
        type,
        position,
        data,
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [setNodes]
  );

  return (
    <>
      <div
        className="content"
        ref={reactFlowWrapper}
        onDrop={onDrop}
        onDragOver={onDragOver}
      >
        <ReactFlow
          nodes={nodes}
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
          onInit={(instance) => (reactFlowInstance.current = instance)}
          fitView
        >
          <MiniMap />
          <Controls />
          <Background variant="dots" gap={16} size={1} />
        </ReactFlow>
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
                      setEdges((eds) =>
                        eds.map((e) =>
                          e.id === editingEdgeId ? { ...e, target: node.id } : e
                        )
                      );
                      setEditingEdgeId(null);
                    }}
                    className={`edge-target-button ${
                      edge?.target === node.id ? "selected" : ""
                    }`}
                  >
                    {node.data.label} ({node.type})
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

export default Canvas;
