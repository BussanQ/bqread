// Keep native assistant items (including reasoning) for the next tool round.
const native = new WeakMap();
export function rememberOutput(message, output) {
  if (output) native.set(message, output);
}

export function modelRequest(config, messages, tools) {
  const { model, baseURL, apiKey, protocol } = config;
  const base = baseURL.replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (protocol === 'anthropic-messages') {
    headers['anthropic-version'] = '2023-06-01';
    if (apiKey) headers['x-api-key'] = apiKey;
    const history = [];
    for (const m of messages.filter(m => m.role !== 'system')) {
      if (m.role === 'tool') {
        const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content };
        const last = history.at(-1);
        if (last?.role === 'user' && Array.isArray(last.content)) last.content.push(block);
        else history.push({ role: 'user', content: [block] });
      } else history.push({ role: m.role, content: native.get(m) ?? m.content });
    }
    return { endpoint: base.replace(/\/v1$/, '') + '/v1/messages', headers, body: { model, max_tokens: 4096,
      system: messages.filter(m => m.role === 'system').map(m => m.content).join('\n'), messages: history,
      tools: tools.map(({ function: f }) => ({ name: f.name, description: f.description, input_schema: f.parameters })) } };
  }
  if (apiKey) {
    if (config.preset === 'azure') headers['api-key'] = apiKey;
    else headers.Authorization = 'Bearer ' + apiKey;
  }
  if (protocol === 'responses') {
    const input = messages.flatMap(m => native.get(m) ?? (m.role === 'tool'
      ? [{ type: 'function_call_output', call_id: m.tool_call_id, output: m.content }]
      : [{ role: m.role, content: m.content }]));
    return { endpoint: base + '/responses', headers, body: { model, store: false, include: ['reasoning.encrypted_content'], input,
      tools: tools.map(({ function: f }) => ({ type: 'function', name: f.name, description: f.description, parameters: f.parameters, strict: false })) } };
  }
  return { endpoint: base + '/chat/completions', headers, body: { model, messages, tools, stream: false } };
}

export function modelChoice(protocol, data) {
  if (protocol === 'chat-completions') return data?.choices?.[0];
  const anthropic = protocol === 'anthropic-messages';
  const output = anthropic ? data?.content : data?.output;
  if (data?.stop_reason === 'max_tokens' || data?.status === 'incomplete') return { finish_reason: 'length' };
  if (!Array.isArray(output) || (anthropic ? !['end_turn', 'stop_sequence', 'tool_use'].includes(data.stop_reason) : data.status !== 'completed')) return;
  const calls = [], texts = [];
  for (const item of output) {
    if (item.type === 'tool_use' || item.type === 'function_call') {
      calls.push({ type: 'function', id: item.call_id ?? item.id, function: { name: item.name, arguments: anthropic ? JSON.stringify(item.input) : item.arguments } });
    } else if (item.type === 'text') texts.push(item.text);
    else if (item.type === 'message') {
      for (const part of item.content ?? []) {
        if (part.type === 'refusal') return { finish_reason: 'content_filter' };
        if (part.type === 'output_text') texts.push(part.text);
      }
    }
  }
  return { nativeOutput: output, finish_reason: calls.length || data.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
    message: { content: texts.join(''), tool_calls: calls } };
}
