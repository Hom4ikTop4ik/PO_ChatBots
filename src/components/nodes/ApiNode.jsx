import { Handle, Position } from "reactflow";
// TODO: добавить проверку типов

export default function ApiNode({ data }) {
  return (
    <div className="node api">
      <strong>{data.label}</strong>
      <div className="node-text">
        {data.method} {data.url}
      </div>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
