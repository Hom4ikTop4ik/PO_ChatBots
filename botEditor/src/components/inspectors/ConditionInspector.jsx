import PropTypes from 'prop-types';

function ConditionInspector({ node, updateNodeData, usedVars }) {
  const data = node.data;
  return (
    <div>
      <h3>Условие</h3>
      <label>
        Метка
        <input
          type="text"
          value={data.label}
          onChange={(e) => updateNodeData(node.id, { label: e.target.value })}
        />
      </label>
      <label>
        Выражение
        <input
          type="text"
          value={data.expression}
          onChange={(e) =>
            updateNodeData(node.id, { expression: e.target.value })
          }
          placeholder="Например: ${x} > 0 или ${status} == 'active'"
        />
      </label>
      {usedVars && usedVars.length > 0 && (
        <div className="variable-suggestions">
          <strong>Доступные переменные:</strong>
          <div className="variable-list">
            {usedVars
              .map((v, i) => <span key={i}>${"{" + v + "}"}</span>)
              .reduce(
                (acc, el, i) => (i === 0 ? [el] : [...acc, ", ", el]),
                []
              )}
          </div>
        </div>
      )}
    </div>
  );
}

ConditionInspector.propTypes = {
  node: PropTypes.object.isRequired,
  updateNodeData: PropTypes.func.isRequired,
  usedVars: PropTypes.array,
};

export default ConditionInspector;
