// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Amazon EC2 config transformation: converts agent-friendly eC2Next fields
// to the ec2Enhancement format the calculator frontend expects.

const SHORTHAND_RE = /^(?:ri|reserved|convertible|instanceSavings|computeSavings|ondemand)(?:(\d)yr)?(?:(No|Partial|All)Upfront)?$/i;

const MODEL_ALIASES = {
  ri: 'reserved', reserved: 'reserved', convertible: 'convertible',
  instancesavings: 'instanceSavings', computesavings: 'computeSavings', ondemand: 'ondemand',
};

const SELECTED_OPTION = {
  ondemand: 'on-demand', reserved: 'standard', convertible: 'convertible',
  instanceSavings: 'instance-savings', computeSavings: 'compute-savings', spot: 'spot',
};

const PAYMENT_ALIASES = { No: 'None', Partial: 'Partial', All: 'All' };

const TENANCY_ALIASES = {
  default: 'shared', shared: 'shared', share: 'shared', 'shared instances': 'shared',
  dedicated: 'dedicated', 'dedicated instances': 'dedicated',
  host: 'host', hosts: 'host', 'dedicated hosts': 'host',
};

const STORAGE_TYPE_ALIASES = {
  gp3: 'Storage General Purpose gp3 GB Mo',
  'general purpose gp3': 'Storage General Purpose gp3 GB Mo',
  'general purpose ssd gp3': 'Storage General Purpose gp3 GB Mo',
  gp2: 'Storage General Purpose GB Mo',
  'general purpose': 'Storage General Purpose GB Mo',
  'general purpose gp2': 'Storage General Purpose GB Mo',
  'general purpose ssd gp2': 'Storage General Purpose GB Mo',
  io1: 'Storage Provisioned IOPS GB Mo',
  'provisioned iops io1': 'Storage Provisioned IOPS GB Mo',
  io2: 'Storage Provisioned IOPS io2 GB month',
  'provisioned iops io2': 'Storage Provisioned IOPS io2 GB month',
  st1: 'Storage Throughput Optimized HDD GB Mo',
  'throughput optimized hdd': 'Storage Throughput Optimized HDD GB Mo',
  sc1: 'Storage Cold HDD GB Mo',
  'cold hdd': 'Storage Cold HDD GB Mo',
  magnetic: 'Storage Magnetic GB Mo',
};

const OS_ALIASES = {
  linux: 'linux', ubuntu: 'linux', debian: 'linux', amazonlinux: 'linux', 'amazon linux': 'linux',
  windows: 'windows', 'windows server': 'windows',
  rhel: 'rhel', redhat: 'rhel', 'red hat': 'rhel',
  suse: 'suse', sles: 'suse',
};

const EMPTY_DATA_TRANSFER = { value: [
  { entryType: 'INBOUND', value: '', unit: 'tb_month', fromRegion: '' },
  { entryType: 'OUTBOUND', value: '', unit: 'tb_month', toRegion: '' },
  { entryType: 'INTRA_REGION', value: '', unit: 'tb_month' },
]};

function parsePricing(input) {
  if (typeof input === 'string') return parseString(input);
  const obj = (input.value?.model) ? input.value : input;
  return normalize(obj.model || 'ondemand', obj.term || '1yr', obj.upfrontPayment || obj.options || 'None');
}

function parseString(str) {
  const m = str.match(SHORTHAND_RE);
  if (m) {
    const modelKey = str.match(/^[a-zA-Z]+/)[0].toLowerCase();
    return {
      model: MODEL_ALIASES[modelKey] || modelKey,
      term: m[1] ? `${m[1]}yr` : '1yr',
      upfrontPayment: m[2] ? (PAYMENT_ALIASES[m[2]] || m[2]) : 'None',
    };
  }
  const lower = str.toLowerCase();
  let model = 'ondemand';
  if (/instance.savings/i.test(lower)) model = 'instanceSavings';
  else if (/compute.savings/i.test(lower)) model = 'computeSavings';
  else if (lower.includes('convertible')) model = 'convertible';
  else if (lower.includes('reserved') || / ri\b/.test(lower)) model = 'reserved';
  else if (lower.includes('spot')) model = 'spot';

  const termMatch = lower.match(/(\d)\s*(?:yr|year)/);
  let upfrontPayment = 'None';
  if (lower.includes('all upfront')) upfrontPayment = 'All';
  else if (lower.includes('partial')) upfrontPayment = 'Partial';

  return { model, term: termMatch ? `${termMatch[1]}yr` : '1yr', upfrontPayment };
}

function normalize(model, term, payment) {
  payment = String(payment || 'None').replace(/Upfront$/i, '');
  if (payment === 'No') payment = 'None';
  return { model, term, upfrontPayment: payment };
}

function normalizeTenancy(input) {
  const key = String(input || 'shared').trim().toLowerCase();
  return TENANCY_ALIASES[key] || 'shared';
}

function normalizeOS(input) {
  const key = String(input || 'linux').trim().toLowerCase();
  return OS_ALIASES[key] || key || 'linux';
}

function normalizeStorageType(input) {
  if (!input) return undefined;
  const raw = String(input).trim();
  return STORAGE_TYPE_ALIASES[raw.toLowerCase()] || raw;
}

function normalizeFileSize(input) {
  if (input == null || input === '') return undefined;
  if (typeof input === 'object') {
    const value = input.value ?? input.amount ?? input.size;
    const unit = input.unit || `${input.sizeUnit || 'gb'}|${input.frequency || 'NA'}`;
    return { value: String(value), unit: String(unit) };
  }
  return { value: String(input), unit: 'gb|NA' };
}

function buildPricingStrategy(parsed, utilization, tenancy) {
  let { model, term, upfrontPayment } = parsed;
  const termStr = term === '3yr' ? '3 Year' : '1 Year';

  // Standard/Convertible RIs are only for dedicated/host tenancy
  if (!tenancy || tenancy === 'shared') {
    if (model === 'reserved') model = 'instanceSavings';
    if (model === 'convertible') model = 'computeSavings';
  }

  const selectedOption = SELECTED_OPTION[model] || 'on-demand';
  if (model === 'ondemand') {
    return { value: { selectedOption: 'on-demand', term: termStr, utilizationValue: utilization || '100', utilizationUnit: '%Utilized/Month' } };
  }
  return { value: { selectedOption, term: termStr, upfrontPayment, model } };
}

function transformConfig(config) {
  const tenancy = normalizeTenancy(config.tenancy);
  const pricing = parsePricing(config.pricingStrategy || 'ondemand');
  const utilization = config.utilization ? String(config.utilization) : '100';
  const storageType = normalizeStorageType(config.storageType);
  const storageAmount = normalizeFileSize(config.storageAmount);

  return {
    tenancy: { value: tenancy },
    selectedOS: { value: normalizeOS(config.selectedOS) },
    workloadSelection: { value: 'consistent' },
    instanceType: { value: String(config.instanceType || '').trim() },
    workload: { value: { workloadType: 'consistent', data: String(config.quantity || '1') } },
    pricingStrategy: buildPricingStrategy(pricing, utilization, tenancy),
    ec2AdvancedPricingMetrics: { value: 1 },
    detailedMonitoringCheckbox: { value: false },
    ...(storageType && { storageType: { value: storageType } }),
    ...(storageAmount && { storageAmount }),
    ...(config.snapshotFrequency != null && { snapshotFrequency: { value: String(config.snapshotFrequency) } }),
    dataTransferForEC2: config.dataTransferForEC2 || EMPTY_DATA_TRANSFER,
  };
}

function validateConfig(config) {
  const errors = [];
  const c = transformConfig(config);
  const tenancy = c.tenancy.value;
  if (!['shared', 'dedicated', 'host'].includes(tenancy)) errors.push(`tenancy inválido: ${tenancy}`);
  if (!c.instanceType.value) errors.push('instanceType requerido para EC2');
  if (c.storageType && !Object.values(STORAGE_TYPE_ALIASES).includes(c.storageType.value)) {
    errors.push(`storageType no reconocido para EC2: ${c.storageType.value}`);
  }
  return { ok: errors.length === 0, errors, normalized: c };
}

module.exports = { transformConfig, validateConfig, normalizeTenancy, normalizeStorageType, normalizeOS };
