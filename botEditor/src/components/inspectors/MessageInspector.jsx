import PropTypes from 'prop-types';

export default function MessageInspector({ node, updateNodeData, usedVars }) {
  const data = node.data;
  return (
    <div>
      <h3>Сообщение</h3>
      <label>
        Метка
        <input
          type="text"
          value={data.label}
          onChange={(e) => updateNodeData(node.id, { label: e.target.value })}
        />
      </label>
      <label>
        Текст сообщения
        <textarea
          rows="3"
          value={data.text}
          onChange={(e) => updateNodeData(node.id, { text: e.target.value })}
          placeholder="Используйте ${varName} для вставки переменных"
        />
        <div className="example-text">
          Пример: Привет, {"$"}
          {"user_name"}! Ваш баланс: {"$"}
          {"balance"}
        </div>
      </label>

      {/* TODO: вынести логику отображения доступных переменных в отдельный компонент и нужно проверять флоу - переменная
      не должна быть доступна если на данном шаге её нет */}
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
MessageInspector.propTypes = {
  node: PropTypes.shape({
    id: PropTypes.string.isRequired,
    data: PropTypes.object.isRequired,
  }).isRequired,
  updateNodeData: PropTypes.func.isRequired,
  usedVars: PropTypes.array,
};