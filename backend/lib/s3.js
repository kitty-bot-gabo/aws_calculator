// Friendly Amazon S3 Standard config transformation for AWS Pricing Calculator.

function normalizeStorageAmount(input) {
  if (input == null || input === '') return { value: '0', unit: 'gb|month' };
  if (typeof input === 'object') {
    const value = input.value ?? input.amount ?? input.size ?? input.storageAmount ?? input.gb;
    const unit = input.unit || `${input.sizeUnit || 'gb'}|${input.frequency || 'month'}`;
    return { value: String(value), unit: String(unit) };
  }
  return { value: String(input), unit: 'gb|month' };
}

function normalizeAverageObjectSize(input) {
  if (input == null || input === '') return { value: '16', unit: 'mb|NA' };
  if (typeof input === 'object') {
    const value = input.value ?? input.amount ?? input.size;
    const unit = input.unit || `${input.sizeUnit || 'mb'}|${input.frequency || 'NA'}`;
    return { value: String(value), unit: String(unit) };
  }
  return { value: String(input), unit: 'mb|NA' };
}

function transformConfig(config = {}) {
  const amount = config.s3StandardStorageSize || config.storageAmount || config.storage || config.monthlyStorage || config.gb || config.gigabytes;
  return {
    s3StandardStorageSize: normalizeStorageAmount(amount),
    moveToStorageClassMethod: { value: config.moveToStorageClassMethod || 'No movement required' },
    S3_Standard_Average_Object_Size: normalizeAverageObjectSize(config.averageObjectSize),
    ...(config.putRequests != null && { s3StandardPutRequests: { value: String(config.putRequests) } }),
    ...(config.getRequests != null && { s3StandardGetRequests: { value: String(config.getRequests) } }),
    ...(config.dataReturnedSize && { s3StandardDataReturnedSize: normalizeStorageAmount(config.dataReturnedSize) }),
    ...(config.dataScannedSize && { s3StandardDataScannedSize: normalizeStorageAmount(config.dataScannedSize) }),
  };
}

function validateConfig(config = {}) {
  const normalized = transformConfig(config);
  const errors = [];
  const value = Number(normalized.s3StandardStorageSize.value);
  if (!Number.isFinite(value) || value < 0) errors.push('storageAmount S3 inválido');
  if (!String(normalized.s3StandardStorageSize.unit).includes('|month')) errors.push('S3 Standard storage debe usar unidad mensual, por ejemplo gb|month');
  return { ok: errors.length === 0, errors, normalized };
}

module.exports = { transformConfig, validateConfig };
