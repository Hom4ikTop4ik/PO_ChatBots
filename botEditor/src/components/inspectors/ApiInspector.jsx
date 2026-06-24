import PropTypes from "prop-types";
import { LockableField } from "../../features/collaboration";
import { useState } from "react";  // ← Важно: импорт useState!

export default function ApiInspector({ node, updateNodeData, usedVars }) {
  const data = node.data;
  
  // Состояние для JSON редактора
  const [variablesJson, setVariablesJson] = useState(
    JSON.stringify(data.variables || {}, null, 2)
  );
  const [jsonError, setJsonError] = useState(null);

  const handleVariablesChange = (e) => {
    const value = e.target.value;
    setVariablesJson(value);
    
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null) {
        setJsonError(null);
        updateNodeData(node.id, { variables: parsed });
      } else {
        setJsonError("Должен быть объект JSON");
      }
    } catch (err) {
      setJsonError("Невалидный JSON: " + err.message);
    }
  };

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
          value={data.label || ""}
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
          value={data.url || ""}
          onChange={(e) => updateNodeData(node.id, { url: e.target.value })}
        />
      </label>
      
      <label>
        Метод
        <LockableField
          blockId={node.id}
          fieldName="method"
          as="select"
          value={data.method || "GET"}
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
              // Игнорируем ошибки парсинга во время ввода
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
          value={data.body || ""}
          onChange={(e) => updateNodeData(node.id, { body: e.target.value })}
        />
      </label>

      <label>
        <strong>Маппинг переменных (JSON)</strong>
        <textarea
          rows={4}
          value={variablesJson}
          onChange={handleVariablesChange}
          style={{
            width: "100%",
            fontFamily: "monospace",
            fontSize: "12px",
            border: jsonError ? "2px solid red" : "1px solid #ccc",
            borderRadius: "4px",
            padding: "8px",
          }}
          placeholder='{
  "weather.0.description": "weather",
  "main.temp": "temperature",
  "name": "city_name"
}'
        />
        {jsonError && (
          <div style={{ color: "red", fontSize: "12px", marginTop: "4px" }}>
            ⚠️ {jsonError}
          </div>
        )}
        <small style={{ color: "#666", display: "block", marginTop: "4px" }}>
          Формат: {"{\"поле.в.ответе\": \"имя_переменной\"}"}
          <br />
          Пример: {"{\"weather.0.description\": \"weather\", \"main.temp\": \"temperature\"}"}
        </small>
      </label>
      
      <label>
        Количество повторов
        <LockableField
          blockId={node.id}
          fieldName="retryCount"
          as="input"
          type="number"
          value={data.retryCount || 0}
          min="0"
          onChange={(e) =>
            updateNodeData(node.id, { retryCount: Number(e.target.value) })
          }
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

ApiInspector.propTypes = {
  node: PropTypes.shape({
    id: PropTypes.string.isRequired,
    data: PropTypes.object.isRequired,
  }).isRequired,
  updateNodeData: PropTypes.func.isRequired,
  usedVars: PropTypes.array,
};
