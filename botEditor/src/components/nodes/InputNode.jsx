import { Handle, Position } from "reactflow";
import { renderTextWithVariables } from "../../utils/scenarioUtils";
// TODO: добавить проверку типов

export default function InputNode({ data }) {
  return (
    <div className="node input">
      <strong>{data.label}</strong>
      <div className="node-text">{renderTextWithVariables(data.prompt)}</div>
      <div className="node-subtext">→ {data.variableName}</div>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
