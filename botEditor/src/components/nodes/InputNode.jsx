import { Handle, Position } from "reactflow";
import { renderTextWithVariables } from "../../utils/scenarioUtils";
import PropTypes from "prop-types";

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

InputNode.propTypes = {
  data: PropTypes.shape({
    label: PropTypes.string,
    prompt: PropTypes.oneOfType([PropTypes.string, PropTypes.node]),
    variableName: PropTypes.string,
  }).isRequired,
};
