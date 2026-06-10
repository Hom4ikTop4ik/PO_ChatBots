export const OPERATION_TYPES = {
  BLOCK_ADD: "BLOCK_ADD",
  BLOCK_MOVE: "BLOCK_MOVE",
  BLOCK_UPDATE: "BLOCK_UPDATE",
  BLOCK_DELETE: "BLOCK_DELETE",
  EDGE_ADD: "EDGE_ADD",
  EDGE_DELETE: "EDGE_DELETE",
  EDGE_UPDATE: "EDGE_UPDATE",
  SCENARIO_REPLACE: "SCENARIO_REPLACE",
};

function cloneNode(node) {
  return {
    ...node,
    position: { ...(node.position || { x: 0, y: 0 }) },
    data: { ...(node.data || {}) },
  };
}

function cloneEdge(edge) {
  return { ...edge };
}

export function makeOperation(type, data, baseVersion = 0) {
  return {
    op_id: crypto.randomUUID(),
    op_type: type,
    base_version: baseVersion,
    timestamp: new Date().toISOString(),
    data,
  };
}

export function createBlockAddOp(node, baseVersion = 0) {
  return makeOperation(
    OPERATION_TYPES.BLOCK_ADD,
    { node: cloneNode(node) },
    baseVersion
  );
}

export function createBlockMoveOp(blockId, position, prevPosition = null, baseVersion = 0) {
  if (
    !position ||
    typeof position.x !== "number" ||
    typeof position.y !== "number"
  ) {
    return null;
  }

  return makeOperation(
    OPERATION_TYPES.BLOCK_MOVE,
    {
      block_id: blockId,
      new_position: {
        x: Math.round(position.x),
        y: Math.round(position.y),
      },
      prev_position: prevPosition 
        ? { x: Math.round(prevPosition.x), y: Math.round(prevPosition.y) } 
        : null,
    },
    baseVersion
  );
}

export function createBlockUpdateOp(blockId, patch, baseVersion = 0) {
  return makeOperation(
    OPERATION_TYPES.BLOCK_UPDATE,
    {
      block_id: blockId,
      patch: { ...patch },
    },
    baseVersion
  );
}

export function createBlockDeleteOp(blockId, baseVersion = 0) {
  return makeOperation(
    OPERATION_TYPES.BLOCK_DELETE,
    { block_id: blockId },
    baseVersion
  );
}

export function createEdgeAddOp(edgeLike, baseVersion = 0) {
  const edge = {
    id: edgeLike.id || `${edgeLike.source}-${edgeLike.target}`,
    source: edgeLike.source,
    target: edgeLike.target,
    ...(edgeLike.label ? { label: edgeLike.label } : {}),
    ...(edgeLike.type ? { type: edgeLike.type } : {}),
  };

  return makeOperation(OPERATION_TYPES.EDGE_ADD, { edge }, baseVersion);
}

export function createEdgeDeleteOp(edgeId, baseVersion = 0) {
  return makeOperation(
    OPERATION_TYPES.EDGE_DELETE,
    { edge_id: edgeId },
    baseVersion
  );
}

export function createEdgeUpdateOp(edgeId, patch, baseVersion = 0) {
  return makeOperation(
    OPERATION_TYPES.EDGE_UPDATE,
    {
      edge_id: edgeId,
      patch: { ...patch },
    },
    baseVersion
  );
}

export function createScenarioReplaceOp(payload, baseVersion = 0) {
  return makeOperation(
    OPERATION_TYPES.SCENARIO_REPLACE,
    {
      nodes: (payload.nodes || []).map(cloneNode),
      edges: (payload.edges || []).map(cloneEdge),
    },
    baseVersion
  );
}

export function applyOperation(editorState, operation) {
  if (!operation) {
    return {
      nodes: (editorState?.nodes || []).map(cloneNode),
      edges: (editorState?.edges || []).map(cloneEdge),
    };
  }

  const current = {
    nodes: (editorState?.nodes || []).map(cloneNode),
    edges: (editorState?.edges || []).map(cloneEdge),
  };

  switch (operation.op_type) {
    case OPERATION_TYPES.BLOCK_ADD: {
      const node = cloneNode(operation.data.node);
      const exists = current.nodes.some((n) => n.id === node.id);
      if (exists) return current;

      return {
        ...current,
        nodes: [...current.nodes, node],
      };
    }

    case OPERATION_TYPES.BLOCK_MOVE: {
      const { block_id, new_position } = operation.data;

      if (
        !new_position ||
        typeof new_position.x !== "number" ||
        typeof new_position.y !== "number"
      ) {
        return current;
      }

      return {
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === block_id
            ? {
                ...node,
                position: {
                  x: new_position.x,
                  y: new_position.y,
                },
              }
            : node
        ),
      };
    }

    case OPERATION_TYPES.BLOCK_UPDATE: {
      const { block_id, patch } = operation.data;

      return {
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === block_id
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...patch,
                },
              }
            : node
        ),
      };
    }

    case OPERATION_TYPES.BLOCK_DELETE: {
      const { block_id } = operation.data;

      return {
        nodes: current.nodes.filter((node) => node.id !== block_id),
        edges: current.edges.filter(
          (edge) => edge.source !== block_id && edge.target !== block_id
        ),
      };
    }

    case OPERATION_TYPES.EDGE_ADD: {
      const edge = cloneEdge(operation.data.edge);
      const exists = current.edges.some((e) => e.id === edge.id);
      if (exists) return current;

      return {
        ...current,
        edges: [...current.edges, edge],
      };
    }

    case OPERATION_TYPES.EDGE_DELETE: {
      const { edge_id } = operation.data;

      return {
        ...current,
        edges: current.edges.filter((edge) => edge.id !== edge_id),
      };
    }

    case OPERATION_TYPES.EDGE_UPDATE: {
      const { edge_id, patch } = operation.data;

      return {
        ...current,
        edges: current.edges.map((edge) =>
          edge.id === edge_id
            ? {
                ...edge,
                ...patch,
              }
            : edge
        ),
      };
    }

    case OPERATION_TYPES.SCENARIO_REPLACE: {
      return {
        nodes: (operation.data.nodes || []).map(cloneNode),
        edges: (operation.data.edges || []).map(cloneEdge),
      };
    }

    default:
      return current;
  }
}

export function createInverseOperation(prev_state, op) {
  switch (op.type) {
    case OPERATION_TYPES.BLOCK_ADD:
      return createBlockDeleteOp(op.data.node.id);

    case OPERATION_TYPES.BLOCK_DELETE:
      return createScenarioReplaceOp({ nodes: prev_state.nodes, edges: prev_state.edges });

    case OPERATION_TYPES.BLOCK_MOVE: {
      if (op.data.prev_position) {
        return createBlockMoveOp(op.data.block_id, op.data.prev_position, op.data.new_position);
      }
      
      const node = prev_state.nodes.find(n => n.id === op.data.block_id);
      return createBlockMoveOp(op.data.block_id, node ? node.position : {x: 0, y: 0});
    }

    case OPERATION_TYPES.BLOCK_UPDATE: {
      const node = prev_state.nodes.find(n => n.id === op.data.block_id);
      const oldPatch = {};
      for (const key in op.data.patch) {
        oldPatch[key] = node ? node.data[key] : undefined;
      }
      return createBlockUpdateOp(op.data.block_id, oldPatch);
    }

    case OPERATION_TYPES.EDGE_ADD:
      return createEdgeDeleteOp(op.data.edge.id);

    case OPERATION_TYPES.EDGE_DELETE: {
      const edge = prev_state.edges.find(e => e.id === op.data.edge_id);
      if (!edge) return null;
      return createEdgeAddOp(edge);
    }

    case OPERATION_TYPES.EDGE_UPDATE: {
      const edge = prev_state.edges.find(e => e.id === op.data.edge_id);
      const oldPatch = {};
      for (const key in op.data.patch) {
        oldPatch[key] = edge ? edge[key] : undefined;
      }
      return createEdgeUpdateOp(op.data.edge_id, oldPatch);
    }

    case OPERATION_TYPES.SCENARIO_REPLACE:
      return createScenarioReplaceOp({ nodes: prev_state.nodes, edges: prev_state.edges });

    default:
      return null;
  }
}
