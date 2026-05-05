import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Bot, Calculator, ExternalLink, Send, Sparkles, Trash2 } from 'lucide-react';
import './styles.css';

const SETTINGS_KEY = 'aws-calculator-chat-settings-v1';
const API = '';

async function api(path, opts) {
  const res = await fetch(`${API}${path}`, opts);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data.error || text || `HTTP ${res.status}`);
  return data;
}
function loadSettings() { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; } }
function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...loadSettings(), ...s })); }

function App() {
  const saved = useMemo(loadSettings, []);
  const [cfg, setCfg] = useState({ providers: ['ollama','openai','deepseek'], models: {}, model_defaults: {}, configured: {} });
  const [provider, setProvider] = useState(saved.provider || 'ollama');
  const [model, setModel] = useState(saved.model || '');
  const [input, setInput] = useState(saved.input || 'Calcula 2 EC2 t3.medium Linux on-demand en us-east-1 con 100GB gp3 cada una para ambiente web');
  const [messages, setMessages] = useState(saved.messages || []);
  const [draft, setDraft] = useState(saved.draft || null);
  const [estimate, setEstimate] = useState(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api('/api/llm/config').then((c) => {
    setCfg(c);
    const p = saved.provider || c.provider || 'ollama';
    setProvider(p === 'disabled' ? 'ollama' : p);
    setModel(saved.providerModels?.[p] || saved.model || c.model_defaults?.[p] || c.models?.[p]?.[0] || '');
  }).catch(e => setError(String(e.message || e))); }, []);
  useEffect(() => saveSettings({ provider, model, input, messages, draft, providerModels: { ...(loadSettings().providerModels || {}), [provider]: model } }), [provider, model, input, messages, draft]);

  function changeProvider(p) {
    const savedNow = loadSettings();
    setProvider(p);
    const next = savedNow.providerModels?.[p] || cfg.model_defaults?.[p] || cfg.models?.[p]?.[0] || '';
    setModel(next);
  }

  async function send(prompt = input) {
    if (!prompt.trim()) return;
    setError(''); setLoading(true); setEstimate(null);
    const userMsg = { role: 'user', content: prompt };
    setMessages(prev => [...prev, userMsg]);
    try {
      const res = await api('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: prompt, history: messages, provider, model, autoCreateEstimate: true }) });
      const assistant = { role: 'assistant', content: res.reply || '(sin respuesta)', draft: res.estimateDraft || null, estimate: res.estimate || null };
      setMessages(prev => [...prev, assistant]);
      if (res.estimateDraft) setDraft(res.estimateDraft);
      if (res.estimate) setEstimate(res.estimate);
    } catch (e) {
      setError(String(e.message || e));
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e.message || e}` }]);
    } finally { setLoading(false); }
  }

  async function createEstimate() {
    if (!draft) return;
    setError(''); setCreating(true);
    try {
      const res = await api('/api/estimate/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ estimateDraft: draft }) });
      setEstimate(res);
      setMessages(prev => [...prev, { role: 'assistant', content: `Estimate creado en AWS Pricing Calculator: ${res.shareableUrl}` }]);
    } catch (e) { setError(String(e.message || e)); }
    finally { setCreating(false); }
  }

  const quick = [
    'Calcula 1 EC2 m7i.large Linux on-demand us-east-1 con 50GB gp3',
    'Calcula ambiente web prod: 2 EC2 t3.medium Linux con 100GB gp3 cada una en us-east-1',
    'Calcula 3 EC2 c7i.xlarge Windows on-demand en us-east-1 sin storage adicional',
  ];
  const external = provider === 'openai' || provider === 'deepseek';

  return <main>
    <header>
      <div><h1><Calculator size={26}/> AWS Calculator Chat</h1><p>Prompt → draft → botón <b>Create estimate</b> oficial en calculator.aws</p></div>
      <div className="pill"><Sparkles size={16}/> MCP tools + LLM</div>
    </header>

    {error && <div className="error">{error}</div>}

    <section className="panel config">
      <label>Proveedor LLM<select value={provider} onChange={e=>changeProvider(e.target.value)}><option value="ollama">Ollama local</option><option value="openai">OpenAI API</option><option value="deepseek">DeepSeek API</option></select></label>
      <label>Modelo<input list="models" value={model} onChange={e=>setModel(e.target.value)} placeholder="modelo"/><datalist id="models">{(cfg.models?.[provider] || []).map(m => <option key={m} value={m}/>)}</datalist></label>
      <div className="note">Secrets/Base URLs viven solo en <code>.env</code>. {external ? (cfg.configured?.[provider] ? 'API key configurada.' : 'Falta API key en backend.') : 'Ollama usa LLM_BASE_URL backend.'} {external && !cfg.allow_external ? 'LLM_ALLOW_EXTERNAL está false.' : ''}</div>
    </section>

    <section className="layout">
      <section className="panel chat">
        <div className="quick">{quick.map(q => <button key={q} onClick={()=>send(q)} disabled={loading}>{q}</button>)}</div>
        <div className="messages">
          {!messages.length && <div className="empty"><Bot/> Pídeme costos AWS en español. Si falta información, te la voy a pedir antes de crear el estimate.</div>}
          {messages.map((m, i) => <div key={i} className={`msg ${m.role}`}><b>{m.role === 'user' ? 'Gabo' : 'AWS Calculator'}</b><p>{m.content}</p>{m.estimate && <a className="inline-link" href={m.estimate.shareableUrl} target="_blank" rel="noreferrer"><ExternalLink size={14}/> Abrir calculadora oficial AWS</a>}{m.draft && !m.estimate && <small>Draft listo para Create estimate.</small>}</div>)}
        </div>
        <div className="composer"><textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&e.ctrlKey)send();}}/><button onClick={()=>send()} disabled={loading || !input.trim()}><Send size={16}/>{loading ? 'Pensando...' : 'Enviar'}</button></div>
      </section>

      <aside className="panel draft">
        <div className="draft-head"><h2>Estimate draft</h2><button className="ghost" onClick={()=>{setDraft(null);setEstimate(null);}}><Trash2 size={15}/> limpiar</button></div>
        {!draft && <p className="muted">Aún no hay draft. Pide un cálculo con región, servicio, tamaño y cantidad.</p>}
        {draft && <>
          <h3>{draft.name}</h3>
          <pre>{JSON.stringify(draft, null, 2)}</pre>
          <button className="create" onClick={createEstimate} disabled={creating}>{creating ? 'Creando en AWS...' : 'Create estimate nuevamente'}</button>
        </>}
        {estimate && <a className="estimate-link" href={estimate.shareableUrl} target="_blank" rel="noreferrer"><ExternalLink size={16}/> Abrir estimate oficial</a>}
      </aside>
    </section>
  </main>;
}

createRoot(document.getElementById('root')).render(<App/>);
