const EstimateBuilder = require('./lib/estimate-builder');
const { loadSavedEstimate, saveEstimate } = require('./lib/aws-client');

function flatten(group) {
  const services = [];
  const walk = (node) => {
    Object.values(node?.services || {}).forEach(svc => services.push(svc));
    Object.values(node?.groups || {}).forEach(walk);
  };
  walk(group);
  return services;
}

async function main() {
  const baseBuilder = new EstimateBuilder('prueba-Gabo');
  baseBuilder.addService('ec2Enhancement', {
    region: 'us-east-1',
    instanceType: 't4g.small',
    selectedOS: 'linux',
    quantity: '1',
    tenancy: 'shared',
    pricingStrategy: 'ondemand',
    storageType: 'gp2',
    storageAmount: '30',
  });
  const base = await baseBuilder.export();

  const addBuilder = new EstimateBuilder('prueba-Gabo');
  addBuilder.addService('amazonS3Standard', {
    region: 'us-east-1',
    description: 'S3 Standard 200GB mensuales',
    storageAmount: '200',
  });
  const additions = await addBuilder.toAWSPayload();
  addBuilder._validatePayload(additions);

  const existing = await loadSavedEstimate(base.estimateId);
  const merged = {
    ...existing,
    services: { ...(existing.services || {}), ...(additions.services || {}) },
    groups: { ...(existing.groups || {}), ...(additions.groups || {}) },
  };
  addBuilder._validatePayload(merged);
  const saved = await saveEstimate(merged);
  const loaded = await loadSavedEstimate(saved.estimateId);
  const services = flatten(loaded);
  const codes = services.map(s => s.serviceCode);
  if (!codes.includes('ec2Enhancement')) throw new Error('Smoke update failed: EC2 missing after update');
  if (!codes.includes('amazonS3Standard')) throw new Error('Smoke update failed: S3 Standard missing after update');
  const s3 = services.find(s => s.serviceCode === 'amazonS3Standard');
  if (s3.calculationComponents?.s3StandardStorageSize?.value !== '200') throw new Error('Smoke update failed: S3 storage amount is not 200GB');

  console.log(JSON.stringify({
    ok: true,
    previousEstimateId: base.estimateId,
    estimateId: saved.estimateId,
    shareableUrl: `https://calculator.aws/#/estimate?id=${saved.estimateId}`,
    serviceCodes: codes,
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
