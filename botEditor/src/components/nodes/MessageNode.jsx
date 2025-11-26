import { Handle, Position } from "reactflow";
import { renderTextWithVariables } from "../../utils/scenarioUtils";

// TODO: добавить проверку типов
export default function MessageNode({ data }) {
  return (
    <div className="node message">
      <strong>{data.label}</strong>
      <div className="node-text">{renderTextWithVariables(data.text)}</div>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
