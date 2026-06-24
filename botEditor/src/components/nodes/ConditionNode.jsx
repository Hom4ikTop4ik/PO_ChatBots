import { Handle, Position } from "reactflow";
import { renderTextWithVariables } from "../../utils/scenarioUtils";
import PropTypes from "prop-types";

export default function ConditionNode({ data }) {
  return (
    <div className="node condition">
      <strong>{data.label}</strong>
      <div className="condition-expression">
        {renderTextWithVariables(data.expression)}
      </div>
      <Handle type="target" position={Position.Top} />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: "#555" }}>
        <span style={{ color: "#388e3c", fontWeight: 700, paddingLeft: 8 }}>✓ Да</span>
        <span style={{ color: "#d32f2f", fontWeight: 700, paddingRight: 8 }}>✗ Нет</span>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="true"
        className="handle-left"
        style={{ "--left": `30%` }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="false"
        className="handle-left"
        style={{ "--left": `70%` }}
      />
    </div>
  );
}
ConditionNode.propTypes = {
  data: PropTypes.shape({
    label: PropTypes.string,
    expression: PropTypes.string,
  }).isRequired,
};
