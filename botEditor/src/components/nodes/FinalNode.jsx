import { Handle, Position } from "reactflow";

export default function FinalNode() {
  return (
    <div className="node final">
      <strong>Финал</strong>
      <Handle type="target" position={Position.Top} />
    </div>
  );
}
