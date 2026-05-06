import PropTypes from "prop-types";
import { LockableField } from "../../features/collaboration";

export default function InputInspector({ node, updateNodeData }) {
  const data = node.data;
  return (
    <div>
      <h3>Ввод</h3>
      <label>
        Метка
        <LockableField
          blockId={node.id}
          fieldName="label"
          as="input"
          type="text"
          value={data.label}
          onChange={(e) => updateNodeData(node.id, { label: e.target.value })}
        />
      </label>
      <label>
        Запрос
        <LockableField
          blockId={node.id}
          fieldName="prompt"
          as="input"
          type="text"
          value={data.prompt}
          onChange={(e) => updateNodeData(node.id, { prompt: e.target.value })}
          placeholder="Используйте ${varName} для вставки переменных"
        />
      </label>
      <label>
        Имя переменной
        <LockableField
          blockId={node.id}
          fieldName="variableName"
          as="input"
          type="text"
          value={data.variableName}
          onChange={(e) =>
            updateNodeData(node.id, { variableName: e.target.value })
          }
        />
      </label>
      <label>
        Тип переменной
        <LockableField
          blockId={node.id}
          fieldName="variableType"
          as="select"
          value={data.variableType}
          onChange={(e) =>
            updateNodeData(node.id, { variableType: e.target.value })
          }
        >
          <option value="string">string</option>
          <option value="number">number</option>
          <option value="date">date</option>
        </LockableField>
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
