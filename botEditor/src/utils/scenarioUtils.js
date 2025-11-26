import React from "react";

export function renderTextWithVariables(text) {
  if (!text) return null;
  const parts = [];
  const regex = /\$\{([^}]+)\}/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        React.createElement(
          "span",
          { key: `text-${lastIndex}` },
          text.substring(lastIndex, match.index)
        )
      );
    }
    parts.push(
      React.createElement(
        "span",
        { key: `var-${match.index}`, className: "var-highlight" },
        match[0]
      )
    );
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(
      React.createElement(
        "span",
        { key: "text-end" },
        text.substring(lastIndex)
      )
    );
  }
  return parts.length > 0 ? parts : text;
}

export function nodeTypeFromScenarioType(type) {
  switch (type) {
    case "sendMessage":
      return "message";
    case "getMessage":
      return "input";
    default:
      return type;
  }
}

export function scenarioTypeFromNodeType(type) {
  switch (type) {
    case "message":
      return "sendMessage";
    case "input":
      return "getMessage";
    default:
      return type;
  }
}

export function fromScenario(scenario) {
  const nodes = scenario.Blocks.map((block) => {
    const type = nodeTypeFromScenarioType(block.Type);
    const data = {};
    data.label = block.BlockName;
    data.kind = type;
    switch (type) {
      case "message":
        data.text = block.Params?.message || "";
        break;
      case "input":
        data.prompt = block.Params?.message || "";
        data.variableName = block.Params?.var || "";
        data.variableType = block.Params?.type || "string";
        break;
      case "condition":
        data.expression = block.Params?.expression || "";
        break;
      case "choice":
        data.prompt = block.Params?.prompt || "";
        data.options = block.Params?.options || [];
        break;
      case "api":
        data.url = block.Params?.url || "";
        data.method = block.Params?.method || "GET";
        data.headers = block.Params?.headers || {};
        data.body = block.Params?.body || "";
        data.resultVariable = block.Params?.resultVariable || "";
        data.retryCount = block.Params?.retryCount || 0;
        break;
      default:
        break;
    }
    return {
      id: block.Block_id,
      type: type,
      position: { x: block.X, y: block.Y },
      data: data,
    };
  });
  const edges = [];
  scenario.Blocks.forEach((block) => {
    const from = block.Block_id;
    block.Connections?.Out?.forEach((to) => {
      edges.push({ id: `${from}-${to}`, source: from, target: to });
    });
  });
  return { nodes, edges };
}

export function toScenario(nodes, edges) {
  const inMap = {};
  const outMap = {};
  edges.forEach((edge) => {
    if (!outMap[edge.source]) outMap[edge.source] = [];
    outMap[edge.source].push(edge.target);
    if (!inMap[edge.target]) inMap[edge.target] = [];
    inMap[edge.target].push(edge.source);
  });
  const blocks = nodes.map((node) => {
    const type = scenarioTypeFromNodeType(node.type);
    const params = {};
    switch (node.type) {
      case "message":
        params.message = node.data.text || "";
        break;
      case "input":
        params.message = node.data.prompt || "";
        params.var = node.data.variableName || "";
        params.type = node.data.variableType || "string";
        break;
      case "condition":
        params.expression = node.data.expression || "";
        break;
      case "choice":
        params.prompt = node.data.prompt || "";
        params.options = node.data.options || [];
        break;
      case "api":
        params.url = node.data.url || "";
        params.method = node.data.method || "GET";
        params.headers = node.data.headers || {};
        params.body = node.data.body || "";
        params.resultVariable = node.data.resultVariable || "";
        params.retryCount = node.data.retryCount || 0;
        break;
      default:
        break;
    }
    return {
      BlockName: node.data.label || "",
      Block_id: node.id,
      Type: type,
      X: Math.round(node.position.x),
      Y: Math.round(node.position.y),
      Params: params,
      Connections: { In: inMap[node.id] || [], Out: outMap[node.id] || [] },
    };
  });
  const startNode = nodes.find((n) => n.type === "start");
  const finalNode = nodes.find((n) => n.type === "final");
  return {
    BotName: "Bot",
    Token: "",
    Start: startNode ? startNode.id : "",
    Final: finalNode ? finalNode.id : "",
    Blocks: blocks,
  };
}

export function createDefaultDataForType(type) {
  switch (type) {
    case "message":
      return { label: "Сообщение", text: "Текст сообщения", kind: "message" };
    case "input":
      return {
        label: "Ввод",
        prompt: "Введите значение",
        variableName: "var1",
        variableType: "string",
        kind: "input",
      };
    case "condition":
      return { label: "Условие", expression: "x > 0", kind: "condition" };
    case "choice":
      return {
        label: "Варианты",
        prompt: "Выберите вариант",
        options: [
          { id: "opt1", label: "Да", value: "yes" },
          { id: "opt2", label: "Нет", value: "no" },
        ],
        kind: "choice",
      };
    case "api":
      return {
        label: "API",
        url: "https://api.example.com",
        method: "GET",
        headers: {},
        body: "",
        resultVariable: "result",
        retryCount: 0,
        kind: "api",
      };
    case "start":
      return { label: "Старт", kind: "start" };
    case "final":
      return { label: "Финал", kind: "final" };
    default:
      return { label: "Блок", kind: type };
  }
}

export function parseVariablesFromText(text) {
  if (!text || typeof text !== "string") return [];
  const vars = new Set();
  const regex = /\$\{([^}]+)\}/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (m[1]) vars.add(m[1]);
  }
  return Array.from(vars);
}

export default null;
