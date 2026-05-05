// Friendly Amazon RDS MySQL config transformation for AWS Pricing Calculator.

function normalizeStorageAmount(input) {
  if (input == null || input === '') return { value: '30', unit: 'gb|NA' };
  if (typeof input === 'object') {
    const value = input.value ?? input.amount ?? input.size ?? input.storageAmount ?? input.gb;
    const unit = input.unit || `${input.sizeUnit || 'gb'}|${input.frequency || 'NA'}`;
    return { value: String(value), unit: String(unit) };
  }
  return { value: String(input), unit: 'gb|NA' };
}

function normalizeInstanceType(config = {}) {
  if (config.instanceType) return String(config.instanceType);
  const cpu = Number(config.cpu || config.vcpu || config.vCPU || config.cpus);
  const memory = Number(String(config.memory || config.ram || config.memoryGb || '').replace(/gb|gib/i, ''));
  if (cpu === 2 && memory === 8) return 'db.t3.large';
  if (cpu === 2 && memory === 4) return 'db.t3.medium';
  if (cpu === 1 && memory === 1) return 'db.t3.micro';
  if (cpu === 4 && memory === 16) return 'db.t3.xlarge';
  return 'db.t3.large';
}

function normalizeDeployment(config = {}) {
  const raw = String(config.deploymentOption || config.deployment || config.multiAz || config.multiAZ || '').toLowerCase();
  if (['true', 'yes', 'si', 'sí', 'multi-az', 'multiaz', 'multi az'].includes(raw)) return 'Multi-AZ';
  return 'Single-AZ';
}

function transformConfig(config = {}) {
  const instanceType = normalizeInstanceType(config);
  const deployment = normalizeDeployment(config);
  const nodes = String(config.quantity || config.instances || config.nodes || 1);
  const utilization = String(config.utilization || 100);
  return {
    columnFormIPM: {
      value: [{
        'Number of Nodes': nodes,
        'Instance Type': instanceType,
        utilizationOut: { value: utilization, unit: '%Utilized/Month' },
        'Deployment Option': deployment,
        TermType: 'OnDemand',
        LeaseContractLength: '',
        PurchaseOption: '',
      }],
    },
    createRDSProxy: { value: '0' },
    storageType: { value: config.storageType || 'General Purpose' },
    storageAmount: normalizeStorageAmount(config.storageAmount || config.storage || config.allocatedStorage || config.allocatedStorageGb),
    DatabaseInsightsSelected: { value: '0' },
    retentionPeriod: { value: '0' },
    addRDSExtendedSupport: { value: '0' },
    additionalBackupStorage: normalizeStorageAmount(config.additionalBackupStorage || 0),
  };
}

function validateConfig(config = {}) {
  const normalized = transformConfig(config);
  const errors = [];
  const row = normalized.columnFormIPM.value[0];
  if (!row['Instance Type']) errors.push('instanceType RDS requerido');
  if (!['Single-AZ', 'Multi-AZ'].includes(row['Deployment Option'])) errors.push(`deployment RDS inválido: ${row['Deployment Option']}`);
  const storage = Number(normalized.storageAmount.value);
  if (!Number.isFinite(storage) || storage < 0) errors.push('storageAmount RDS inválido');
  return { ok: errors.length === 0, errors, normalized };
}

module.exports = { transformConfig, validateConfig, normalizeInstanceType };
