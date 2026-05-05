const express = require('express');
const cors = require('cors');
const { loadManifest, searchServices, fetchServiceDefinition, extractInputFields, loadSavedEstimate, saveEstimate } = require('./lib/aws-client');
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
- S3 Standard usando serviceKey "amazonS3Standard" con config amigable: region, description, storageAmount o s3StandardStorageSize en GB mensuales, putRequests, getRequests.
- Si el usuario pide actualizar/editar una calculadora existente y hay un link calculator.aws/#/estimate?id=... en el mensaje o historial, devuelve SOLO los servicios nuevos a agregar en estimateDraft; el backend hará merge con la calculadora existente.
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
      { "serviceKey": "ec2Enhancement", "config": { "region":"us-east-1", "description":"Web EC2 t3.medium 2 instancias 100GB", "instanceType":"t3.medium", "selectedOS":"linux", "quantity": "2", "tenancy":"shared", "pricingStrategy":"ondemand", "storageType":"gp3", "storageAmount":"100" } },
      { "serviceKey": "amazonS3Standard", "config": { "region":"us-east-1", "description":"S3 Standard 200GB mensuales", "storageAmount":"200" } }
    ]
  }
}
Si no hay suficiente información, estimateDraft debe ser null y needsMoreInfo true.`;

function normalizeServiceKey(serviceKey) {
  const key = String(serviceKey || '').trim();
  const lower = key.toLowerCase().replace(/[\s_-]+/g, '');
  if (['s3', 's3standard', 'amazons3', 'amazons3standard'].includes(lower)) return 'amazonS3Standard';
  if (['ec2', 'amazonec2', 'ec2enhancement'].includes(lower)) return 'ec2Enhancement';
  return key;
}

function normalizeServiceDescription(serviceKey, config) {
  if (config.description && String(config.description).trim()) return String(config.description).slice(0, 120);
  if (serviceKey === 'ec2Enhancement') {
    const bits = ['EC2', config.instanceType, config.quantity ? `${config.quantity} instancia(s)` : null, config.storageAmount ? `${typeof config.storageAmount === 'object' ? config.storageAmount.value : config.storageAmount}GB` : null]
      .filter(Boolean);
    return bits.join(' ').slice(0, 120) || 'Amazon EC2';
  }
  if (serviceKey === 'amazonS3Standard') {
    const amount = config.storageAmount || config.s3StandardStorageSize || config.storage || config.monthlyStorage;
    return `S3 Standard${amount ? ` ${typeof amount === 'object' ? amount.value : amount}GB mensuales` : ''}`.slice(0, 120);
  }
  return serviceKey;
}

function extractEstimateId(text) {
  const s = String(text || '');
  const urlMatch = s.match(/calculator\.aws\/#\/estimate\?[^\s)>'"]*\bid=([a-f0-9]{20,})/i);
  if (urlMatch) return urlMatch[1];
  const idMatch = s.match(/\bid=([a-f0-9]{20,})\b/i);
  return idMatch ? idMatch[1] : null;
}

function wantsUpdate(text) {
  return /\b(actualiza|actualizalo|actualízalo|editar|edita|agrega|añade|sumar|modifica|update|add)\b/i.test(String(text || ''));
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
      const serviceKey = normalizeServiceKey(s.serviceKey || s.service || '');
      const config = s.config && typeof s.config === 'object' ? { ...s.config } : {};
      if (serviceKey) config.description = normalizeServiceDescription(serviceKey, config);
      return { serviceKey, group: normalizeGroup(s.group), config };
    }).filter(s => s.serviceKey && Object.keys(s.config).length),
  };
}

function addDraftToBuilder(builder, clean) {
  for (const svc of clean.services) {
    builder.addService(svc.serviceKey, svc.config, { group: svc.group });
  }
}

function mergePayload(base, additions) {
  return {
    ...base,
    name: base.name || additions.name,
    services: { ...(base.services || {}), ...(additions.services || {}) },
    groups: { ...(base.groups || {}), ...(additions.groups || {}) },
    metaData: {
      ...(base.metaData || {}),
      locale: base.metaData?.locale || 'en_US',
      currency: base.metaData?.currency || 'USD',
      source: 'calculator-platform',
      createdOn: base.metaData?.createdOn || new Date().toISOString(),
    },
  };
}

async function exportDraft(draft, { existingEstimateId } = {}) {
  const clean = normalizeDraft(draft);
  if (!clean || !clean.services.length) throw new Error('Draft sin servicios válidos');
  const builder = new EstimateBuilder(clean.name || 'AWS Estimate');
  addDraftToBuilder(builder, clean);

  if (existingEstimateId) {
    const base = await loadSavedEstimate(existingEstimateId);
    const additions = await builder.toAWSPayload();
    builder._validatePayload(additions);
    const merged = mergePayload(base, additions);
    builder._validatePayload(merged);
    const result = await saveEstimate(merged);
    const savedEstimate = await loadSavedEstimate(result.estimateId);
    const validation = builder._validateSavedEstimate(savedEstimate);
    const serviceCodes = builder._flattenServices(savedEstimate).map(s => s.serviceCode);
    for (const svc of clean.services) {
      if (!serviceCodes.includes(svc.serviceKey)) validation.errors.push(`Servicio agregado no encontrado tras guardar: ${svc.serviceKey}`);
    }
    validation.ok = validation.errors.length === 0;
    if (!validation.ok) throw new Error(`AWS guardó el estimate actualizado, pero no validó: ${validation.errors.join('; ')}`);
    return { estimateId: result.estimateId, previousEstimateId: existingEstimateId, shareableUrl: `https://calculator.aws/#/estimate?id=${result.estimateId}`, validation };
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
    const contextText = [String(message), ...history.slice(-8).map(m => String(m.content || ''))].join('\n');
    const existingEstimateId = wantsUpdate(message) ? extractEstimateId(contextText) : null;

    if (autoCreateEstimate && draft && !parsed.needsMoreInfo) {
      estimate = await exportDraft(draft, { existingEstimateId });
      reply = `${reply}\n\nEnlace oficial AWS Pricing Calculator${existingEstimateId ? ' actualizado' : ''}:\n${estimate.shareableUrl}`;
    }

    res.json({ reply, needsMoreInfo: Boolean(parsed.needsMoreInfo), estimateDraft: draft, estimate, raw });
  } catch (e) { next(e); }
});

app.post('/api/estimate/export', async (req, res, next) => {
  try {
    const result = await exportDraft(req.body?.estimateDraft || req.body, { existingEstimateId: req.body?.existingEstimateId });
    res.json({ ...result, label: 'Create estimate' });
  } catch (e) { next(e); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || String(err) });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`aws_calculator backend listening on ${port}`));
