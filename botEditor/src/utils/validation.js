import { parseVariablesFromText } from "./scenarioUtils";

function parseVariablesFromExpression(expr) {
  if (!expr || typeof expr !== "string") return [];
  const vars = new Set();
  const regex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
  let m;
  while ((m = regex.exec(expr)) !== null) {
    const name = m[1];
    if (["true", "false", "null", "undefined"].includes(name)) continue;
    if (!isNaN(Number(name))) continue;
    vars.add(name);
  }
  return Array.from(vars);
}


// TODO: проверять что переменные имеют уникальные имена
// TODO: проверять что URL валиден
// TODO: проверять что используемые переменные определены в момент исполнения блока
export function validateScenario(nodes, edges, globalVars) {
  const errors = [];
  const definedVars = new Set();
  (globalVars || []).forEach((v) => {
    const trimmed = v && v.trim();
    if (trimmed) definedVars.add(trimmed);
  });
  nodes.forEach((node) => {
    if (node.type === "input" && node.data.variableName) {
      definedVars.add(node.data.variableName);
    }
    if (node.type === "api" && node.data.resultVariable) {
      definedVars.add(node.data.resultVariable);
    }
  });
  nodes.forEach((node) => {
    if (node.type === "message") {
      const text = node.data.text || "";
      const vars = parseVariablesFromText(text);
      vars.forEach((v) => {
        if (!definedVars.has(v)) {
          errors.push(
            `Блок "${node.data.label}" использует неопределенную переменную ${v}`
          );
        }
      });
    }
  });
  nodes.forEach((node) => {
    if (node.type === "condition") {
      const expr = node.data.expression || "";
      const vars = parseVariablesFromExpression(expr);
      vars.forEach((v) => {
        if (!definedVars.has(v)) {
          errors.push(
            `Условие "${node.data.label}" использует неопределенную переменную ${v}`
          );
        }
      });
    }
  });
  const adj = {};
  nodes.forEach((node) => {
    adj[node.id] = [];
  });
  edges.forEach((edge) => {
    if (adj[edge.source]) adj[edge.source].push(edge.target);
  });
  let cycleFound = false;
  const visited = new Set();
  const recStack = new Set();
  function dfs(nodeId) {
    if (cycleFound) return;
    visited.add(nodeId);
    recStack.add(nodeId);
    const children = adj[nodeId] || [];
    for (const child of children) {
      if (recStack.has(child)) {
        cycleFound = true;
        return;
      }
      if (!visited.has(child)) {
        dfs(child);
      }
    }
    recStack.delete(nodeId);
  }
  nodes.forEach((node) => {
    if (!visited.has(node.id)) dfs(node.id);
  });
  if (cycleFound) {
    errors.push("В конфигурации обнаружен циклический маршрут");
  }
  const startNodes = nodes.filter((n) => n.type === "start");
  if (startNodes.length === 0) {
    errors.push("Отсутствует стартовый блок");
  } else if (startNodes.length > 1) {
    errors.push("Несколько стартовых блоков");
  }
  const finalNodes = nodes.filter((n) => n.type === "final");
  if (finalNodes.length === 0) {
    errors.push("Отсутствует финальный блок");
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}
