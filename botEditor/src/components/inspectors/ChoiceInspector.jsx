// TODO: добавить проверку типов

export default function ChoiceInspector({ node, updateNodeData, usedVars }) {
  const data = node.data;
  return (
    <div>
      <h3>Варианты выбора</h3>
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
          placeholder="Используйте ${'$'}{varName} для вставки переменных"
        />
      </label>
      <label>
        Переменная результата
        <input
          type="text"
          value={data.resultVariable}
          onChange={(e) =>
            updateNodeData(node.id, { resultVariable: e.target.value })
          }
        />
      </label>
      <label>
        Опции (JSON)
        <textarea
          rows="4"
          value={JSON.stringify(data.options || [], null, 2)}
          onChange={(e) => {
            try {
              const parsed = JSON.parse(e.target.value);
              if (Array.isArray(parsed)) {
                updateNodeData(node.id, { options: parsed });
              }
            } catch {}
          }}
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
