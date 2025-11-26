import React from "react";
import { Handle, Position } from "reactflow";
import { renderTextWithVariables } from "../../utils/scenarioUtils";
// TODO: добавить проверку типов

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
