function csv(value) { return String(value || '').split(',').map(x => x.trim()).filter(Boolean); }

function providerDefaults(provider) {
  if (provider === 'ollama') return { baseUrl: process.env.LLM_BASE_URL || 'http://host.docker.internal:11434', model: process.env.LLM_MODEL || 'llama3.1:8b', apiKey: '', models: csv(process.env.OLLAMA_MODELS || 'llama3.1:8b,qwen3.5:9b'), external: false };
  if (provider === 'openai') return { baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1', model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', apiKey: process.env.OPENAI_API_KEY || '', models: csv(process.env.OPENAI_MODELS || 'gpt-4.1-mini,gpt-4.1,gpt-4o-mini'), external: true };
  if (provider === 'deepseek') return { baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com', model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash', apiKey: process.env.DEEPSEEK_API_KEY || '', models: csv(process.env.DEEPSEEK_MODELS || 'deepseek-v4-flash,deepseek-v4-pro,deepseek-chat,deepseek-reasoner'), external: true };
  return { baseUrl: '', model: '', apiKey: '', models: [], external: false };
}

function publicConfig() {
  const provider = (process.env.LLM_PROVIDER || 'ollama').toLowerCase();
  const providers = ['ollama', 'openai', 'deepseek'];
  const models = Object.fromEntries(providers.map(p => [p, providerDefaults(p).models]));
  const model_defaults = Object.fromEntries(providers.map(p => [p, providerDefaults(p).model]));
  return {
    provider,
    providers,
    models,
    model_defaults,
    allow_external: String(process.env.LLM_ALLOW_EXTERNAL || 'false').toLowerCase() === 'true',
    configured: {
      ollama: Boolean(process.env.LLM_BASE_URL),
      openai: Boolean(process.env.OPENAI_API_KEY),
      deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
    },
  };
}

function extractJson(text) {
  const cleaned = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) return JSON.parse(match[0]);
  throw new Error('El LLM no devolvió JSON válido');
}

async function chatComplete({ provider, model, messages, json = false }) {
  provider = (provider || process.env.LLM_PROVIDER || 'ollama').toLowerCase();
  const cfg = providerDefaults(provider);
  model = model || cfg.model;
  if (provider === 'disabled') throw new Error('LLM_PROVIDER está disabled');
  if (!['ollama', 'openai', 'deepseek'].includes(provider)) throw new Error(`Proveedor no soportado: ${provider}`);
  if (cfg.external && String(process.env.LLM_ALLOW_EXTERNAL || 'false').toLowerCase() !== 'true') throw new Error('Proveedor externo bloqueado: setea LLM_ALLOW_EXTERNAL=true en .env');
  if (cfg.external && !cfg.apiKey) throw new Error(`Falta API key para ${provider} en .env`);

  const timeout = Number(process.env.LLM_TIMEOUT_SECONDS || 120) * 1000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    if (provider === 'ollama') {
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/api/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ model, messages, stream: false, format: json ? 'json' : undefined }),
      });
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      return data.message?.content || '';
    }
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model, messages, temperature: 0.1, response_format: json ? { type: 'json_object' } : undefined }),
    });
    if (!res.ok) throw new Error(`${provider} HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { publicConfig, providerDefaults, chatComplete, extractJson };
