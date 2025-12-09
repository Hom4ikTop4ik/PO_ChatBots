import React from "react";
import { Handle, Position } from "reactflow";
import { renderTextWithVariables } from "../../utils/scenarioUtils";
import PropTypes from "prop-types";

export default function ChoiceNode({ data }) {
  return (
    <div className="node choice">
      <strong>{data.label}</strong>
      <div className="node-text">{renderTextWithVariables(data.prompt)}</div>
      {data.options && data.options.length > 0 && (
        <div className="choice-options">
          {data.options.map((opt) => opt.label).join(", ")}
        </div>
      )}
      <Handle type="target" position={Position.Top} />
      {data.options &&
        data.options.map((opt, index) => {
          const leftPercent = Math.round(
            (index + 1) * (100 / (data.options.length + 1))
          );
          return (
            <Handle
              key={opt.id}
              type="source"
              position={Position.Bottom}
              id={opt.id}
              className="handle-left"
              style={{ "--left": `${leftPercent}%` }}
            />
          );
        })}
    </div>
  );
}
ChoiceNode.propTypes = {
  data: PropTypes.shape({
    label: PropTypes.string,
    prompt: PropTypes.oneOfType([PropTypes.string, PropTypes.node]),
    options: PropTypes.arrayOf(
      PropTypes.shape({
        id: PropTypes.string.isRequired,
        label: PropTypes.string.isRequired,
      })
    ),
  }).isRequired,
};