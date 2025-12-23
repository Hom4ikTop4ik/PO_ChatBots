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
