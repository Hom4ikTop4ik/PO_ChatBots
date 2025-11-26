import { Handle, Position } from "reactflow";

export default function StartNode() {
  return (
    <div className="node start">
      <strong>Старт</strong>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
