import { modelRequest, modelChoice, rememberOutput } from './model-protocols.mjs';

function failure(message, status = 502) {
  return Object.assign(new Error(message), { status });
}

// Only the model transport and tool loop are shared; book rules live in book-chat.
export function createChatAgent(options = {}) {
  async function request(config, messages, tools, signal) {
    const { model, baseURL, protocol } = config;
    if (typeof model !== 'string' || !model.trim()) {
      throw failure('请在首页「AI 提供商」配置模型，或在服务端设置 BQREAD_AI_MODEL。', 503);
    }
    let endpoint;
    try {
      endpoint = new URL(baseURL);
      if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error();
    } catch {
      throw failure('BQREAD_AI_BASE_URL 无效，请填写模型 API 基础地址（通常以 /v1 结尾）。', 503);
    }
    let response;
    try {
      const wire = modelRequest(config, messages, tools);
      response = await (options.transport ?? fetch)(wire.endpoint, { method: 'POST', redirect: 'error', signal,
        headers: wire.headers, body: JSON.stringify(wire.body) });
    } catch (error) {
      signal.throwIfAborted();
      throw failure('连接模型服务失败，请检查 API 基础地址和网络。');
    }
    if (!response.ok) {
      await response.body?.cancel();
      if ([401, 403].includes(response.status)) throw failure('模型服务认证失败，请检查连接的 API 密钥。');
      if (response.status === 429) throw failure('模型服务请求过于频繁或额度不足，请稍后重试。');
      throw failure(`模型服务返回 HTTP ${response.status}，请检查模型名称、协议及工具调用支持。`);
    }
    let data;
    try { data = await response.json(); }
    catch {
      signal.throwIfAborted();
      throw failure('模型服务返回了无效的 JSON 响应。');
    }
    const choice = modelChoice(protocol, data);
    if (choice?.finish_reason === 'length') throw failure('模型回答达到输出长度上限，请缩小问题范围后重试。');
    if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) throw failure('模型服务未能回答这个问题，请调整问题后重试。');
    if (!choice?.message || !['stop', 'tool_calls'].includes(choice.finish_reason)) throw failure('模型服务未返回完整回答，请重试。');
    const { content, tool_calls: calls, reasoning_content: reasoning } = choice.message;
    if ((content !== null && content !== undefined && typeof content !== 'string') ||
      (calls !== undefined && !Array.isArray(calls))) throw failure('模型服务返回了无效的回答格式。');
    if (choice.finish_reason === 'tool_calls' && !calls?.length) throw failure('模型服务未返回完整的工具调用。');
    const message = { role: 'assistant', content: content ?? null };
    if (calls?.length) {
      const ids = new Set();
      for (const call of calls) {
        if (!call || typeof call.id !== 'string' || !call.id || ids.has(call.id) || call.type !== 'function' ||
          typeof call.function?.name !== 'string' || typeof call.function?.arguments !== 'string') {
          throw failure('模型服务返回了无效的工具调用。');
        }
        ids.add(call.id);
      }
      message.tool_calls = calls;
    }
    // Reasoning models can require this field when continuing a tool-use turn.
    if (typeof reasoning === 'string') message.reasoning_content = reasoning;
    rememberOutput(message, choice.nativeOutput);
    return message;
  }

  return async function run({ messages, tools, execute, finish, signal }) {
    const config = (options.getConfig ? await options.getConfig() : options) ?? {};
    const connection = { protocol: 'chat-completions', baseURL: 'https://api.openai.com/v1', ...options.defaults, ...config };
    let corrections = 0;
    let calls = 0;
    let toolCharacters = 0;
    for (let round = 0; round < 24; round++) {
      signal.throwIfAborted();
      const message = await request(connection, messages, tools, signal);
      messages.push(message);
      if (!message.tool_calls?.length) {
        const result = finish(message.content ?? '');
        if (!result.error) return result.value;
        if (corrections++ >= 1) throw failure(result.error);
        messages.push({ role: 'user', content: '回答校验未通过：' + result.error + ' 请根据现有工具结果修正；需要时继续查书。只返回规定的 JSON。' });
        continue;
      }
      for (const call of message.tool_calls) {
        if (++calls > 64) throw failure('本轮查书次数已达上限，请缩小章节或问题范围后重试。');
        let output;
        let args;
        try { args = JSON.parse(call.function.arguments); }
        catch { output = { error: '工具参数不是有效 JSON，请修正后再调用。' }; }
        if (!output) {
          try { output = await execute(call.function.name, args); }
          catch (error) {
            signal.throwIfAborted();
            if (!error.toolInput) throw error;
            output = { error: error.message };
          }
        }
        const content = JSON.stringify(output);
        toolCharacters += content.length;
        if (toolCharacters > 160000) throw failure('本轮查阅内容较多，请缩小章节或问题范围后重试。');
        messages.push({ role: 'tool', tool_call_id: call.id, content });
      }
    }
    throw failure('本轮查书次数已达上限，请缩小章节或问题范围后重试。');
  };
}
