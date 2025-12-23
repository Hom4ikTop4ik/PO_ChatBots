import PropTypes from 'prop-types';
export default function InputInspector({ node, updateNodeData }) {
  const data = node.data;
  return (
    <div>
      <h3>Ввод</h3>
      <label>
        Метка
        <input
          type="text"
          value={data.label}
          onChange={(e) => updateNodeData(node.id, { label: e.target.value })}
        />
      </label>
      <label>
        Запрос
        <input
          type="text"
          value={data.prompt}
          onChange={(e) => updateNodeData(node.id, { prompt: e.target.value })}
          placeholder="Используйте ${varName} для вставки переменных"
        />
      </label>
      <label>
        Имя переменной
        <input
          type="text"
          value={data.variableName}
          onChange={(e) =>
            updateNodeData(node.id, { variableName: e.target.value })
          }
        />
      </label>
      <label>
        Тип переменной
        <select
          value={data.variableType}
          onChange={(e) =>
            updateNodeData(node.id, { variableType: e.target.value })
          }
        >
          <option value="string">string</option>
          <option value="number">number</option>
          <option value="date">date</option>
        </select>
      </label>
    </div>
  );
}
InputInspector.propTypes = {
  node: PropTypes.shape({
    id: PropTypes.string.isRequired,
    data: PropTypes.object.isRequired,
  }).isRequired,
  updateNodeData: PropTypes.func.isRequired,
};