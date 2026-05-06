import PropTypes from "prop-types";
import { LockableField } from "../../features/collaboration";

export default function ApiInspector({ node, updateNodeData }) {
  const data = node.data;
  return (
    <div>
      <h3>API Запрос</h3>
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
        URL
        <LockableField
          blockId={node.id}
          fieldName="url"
          as="input"
          type="text"
          value={data.url}
          onChange={(e) => updateNodeData(node.id, { url: e.target.value })}
        />
      </label>
      <label>
        Метод
        <LockableField
          blockId={node.id}
          fieldName="method"
          as="select"
          value={data.method}
          onChange={(e) => updateNodeData(node.id, { method: e.target.value })}
        >
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="DELETE">DELETE</option>
        </LockableField>
      </label>
      <label>
        Заголовки (JSON)
        <LockableField
          blockId={node.id}
          fieldName="headers"
          as="textarea"
          rows="3"
          value={JSON.stringify(data.headers || {}, null, 2)}
          onChange={(e) => {
            try {
              const parsed = JSON.parse(e.target.value);
              updateNodeData(node.id, { headers: parsed });
            } catch {
            }
          }}
        />
      </label>
      <label>
        Тело запроса
        <LockableField
          blockId={node.id}
          fieldName="body"
          as="textarea"
          rows="3"
          value={data.body}
          onChange={(e) => updateNodeData(node.id, { body: e.target.value })}
        />
      </label>
      <label>
        {/* TODO: сделать так чтобы переменная здесь отображалась как возможная для использования (как варианты в инспекторе сообщения) */}
        Переменная результата
        <LockableField
          blockId={node.id}
          fieldName="resultVariable"
          as="input"
          type="text"
          value={data.resultVariable}
          onChange={(e) =>
            updateNodeData(node.id, { resultVariable: e.target.value })
          }
        />
      </label>
      <label>
        Количество повторов
        <LockableField
          blockId={node.id}
          fieldName="retryCount"
          as="input"
          type="number"
          value={data.retryCount}
          min="0"
          onChange={(e) =>
            updateNodeData(node.id, { retryCount: Number(e.target.value) })
          }
        />
      </label>
    </div>
  );
}

ApiInspector.propTypes = {
  node: PropTypes.shape({
    id: PropTypes.string.isRequired,
    data: PropTypes.object.isRequired,
  }).isRequired,
  updateNodeData: PropTypes.func.isRequired,
};
