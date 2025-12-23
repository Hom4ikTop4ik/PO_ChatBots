import { Handle, Position } from "reactflow";
import { renderTextWithVariables } from "../../utils/scenarioUtils";
import PropTypes from "prop-types";

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

MessageNode.propTypes = {
  data: PropTypes.shape({
    label: PropTypes.string,
    text: PropTypes.oneOfType([PropTypes.string, PropTypes.node]),
  }).isRequired,
};
