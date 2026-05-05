const express = require('express');
const cors = require('cors');
const { loadManifest, searchServices, fetchServiceDefinition, extractInputFields } = require('./lib/aws-client');
const EstimateBuilder = require('./lib/estimate-builder');
const { publicConfig, chatComplete, extractJson } = require('./llm');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const SYSTEM_PROMPT = `Eres un arquitecto Cloud/SRE experto en AWS Pricing Calculator.
Tu tarea es transformar solicitudes en español a un draft de estimate para calculator.aws.
Prioridad: responder directo, pedir datos faltantes si son necesarios, y cuando tengas suficiente información devolver un estimateDraft.
Servicios soportados de forma confiable al inicio:
- EC2 usando serviceKey "ec2Enhancement" con config amigable: region, description, instanceType, selectedOS, quantity, pricingStrategy, utilization, tenancy, storageType, storageAmount.
  Valores EC2 válidos: tenancy "shared" (default), "dedicated" o "host"; selectedOS "linux", "windows", "rhel" o "suse"; storageType puede ser alias "gp3", "gp2", "io1", "io2", "st1", "sc1" o "magnetic".
  Si el usuario no pide un grupo explícito, NO inventes group y NO uses "opcional". Usa description descriptiva, por ejemplo "EC2 t4g.small 100% 30GB".
- Otros servicios avanzados pueden usarse solo si conoces field IDs exactos de AWS Calculator.
Regiones por defecto: us-east-1 salvo que el usuario indique otra. Moneda AWS Calculator: USD.
No inventes cantidades críticas. Si falta tamaño/cantidad, pregunta.
Devuelve SIEMPRE JSON válido con esta forma:
{
  "reply": "respuesta breve en español",
  "needsMoreInfo": false,
  "estimateDraft": {
    "name": "nombre estimate",
    "services": [
      { "serviceKey": "ec2Enhancement", "config": { "region":"us-east-1", "description":"Web EC2 t3.medium 2 instancias 100GB", "instanceType":"t3.medium", "selectedOS":"linux", "quantity": "2", "tenancy":"shared", "pricingStrategy":"ondemand", "storageType":"gp3", "storageAmount":"100" } }
    ]
  }
}
Si no hay suficiente información, estimateDraft debe ser null y needsMoreInfo true.`;

function normalizeServiceDescription(serviceKey, config) {
  if (config.description && String(config.description).trim()) return String(config.description).slice(0, 120);
  if (serviceKey === 'ec2Enhancement') {
    const bits = ['EC2', config.instanceType, config.quantity ? `${config.quantity} instancia(s)` : null, config.storageAmount ? `${typeof config.storageAmount === 'object' ? config.storageAmount.value : config.storageAmount}GB` : null]
      .filter(Boolean);
    return bits.join(' ').slice(0, 120) || 'Amazon EC2';
  }
  return serviceKey;
}

function normalizeGroup(group) {
  if (!group) return undefined;
  const value = String(group).trim();
  if (!value) return undefined;
  if (['opcional', 'optional', 'default', 'general'].includes(value.toLowerCase())) return undefined;
  return value.slice(0, 80);
}

function normalizeDraft(draft) {
  if (!draft || !Array.isArray(draft.services)) return null;
  return {
    name: String(draft.name || 'AWS Estimate').slice(0, 80),
    services: draft.services.map((s) => {
      const serviceKey = String(s.serviceKey || s.service || '').trim();
      const config = s.config && typeof s.config === 'object' ? { ...s.config } : {};
      if (serviceKey) config.description = normalizeServiceDescription(serviceKey, config);
      return { serviceKey, group: normalizeGroup(s.group), config };
    }).filter(s => s.serviceKey && Object.keys(s.config).length),
  };
}

async function exportDraft(draft) {
  const clean = normalizeDraft(draft);
  if (!clean || !clean.services.length) throw new Error('Draft sin servicios válidos');
  const builder = new EstimateBuilder(clean.name || 'AWS Estimate');
  for (const svc of clean.services) {
    builder.addService(svc.serviceKey, svc.config, { group: svc.group });
  }
  return await builder.export();
}

app.get('/api/health', (_, res) => res.json({ ok: true }));
app.get('/api/llm/config', (_, res) => res.json(publicConfig()));

app.get('/api/aws/search', async (req, res, next) => {
  try {
    const manifest = await loadManifest('aws');
    res.json(searchServices(manifest, String(req.query.q || 'ec2').slice(0, 80)).slice?.(0, 30) || searchServices(manifest, String(req.query.q || 'ec2')));
  } catch (e) { next(e); }
});

app.get('/api/aws/fields/:serviceKey', async (req, res, next) => {
  try {
    const manifest = await loadManifest('aws');
    const def = await fetchServiceDefinition(manifest, req.params.serviceKey, 'aws');
    if (!def) return res.status(404).json({ error: 'Servicio no encontrado' });
    res.json({ serviceKey: req.params.serviceKey, fields: extractInputFields(def).slice(0, 400) });
  } catch (e) { next(e); }
});

app.post('/api/chat', async (req, res, next) => {
  try {
    const { message, history = [], provider, model, autoCreateEstimate = true } = req.body || {};
    if (!message || !String(message).trim()) return res.status(400).json({ error: 'message requerido' });
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.slice(-8).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) })),
      { role: 'user', content: String(message).slice(0, 8000) },
    ];
    const raw = await chatComplete({ provider, model, messages, json: true });
    const parsed = extractJson(raw);
    const draft = normalizeDraft(parsed.estimateDraft);
    let estimate = null;
    let reply = parsed.reply || raw;

    if (autoCreateEstimate && draft && !parsed.needsMoreInfo) {
      estimate = await exportDraft(draft);
      reply = `${reply}\n\nEnlace oficial AWS Pricing Calculator:\n${estimate.shareableUrl}`;
    }

    res.json({ reply, needsMoreInfo: Boolean(parsed.needsMoreInfo), estimateDraft: draft, estimate, raw });
  } catch (e) { next(e); }
});

app.post('/api/estimate/export', async (req, res, next) => {
  try {
    const result = await exportDraft(req.body?.estimateDraft || req.body);
    res.json({ ...result, label: 'Create estimate' });
  } catch (e) { next(e); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || String(err) });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`aws_calculator backend listening on ${port}`));
