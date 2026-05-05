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
  addBuilder.addService('rds', {
    region: 'us-east-1',
    description: 'RDS MySQL db.t3.large 30GB Single-AZ',
    cpu: '2',
    memory: '8',
    storageAmount: '30',
    multiAz: false,
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
  if (!codes.includes('amazonRDSMySQLDB')) throw new Error('Smoke update failed: RDS MySQL missing after update');
  const s3 = services.find(s => s.serviceCode === 'amazonS3Standard');
  if (s3.calculationComponents?.s3StandardStorageSize?.value !== '200') throw new Error('Smoke update failed: S3 storage amount is not 200GB');
  const rds = services.find(s => s.serviceCode === 'amazonRDSMySQLDB');
  if (rds.calculationComponents?.storageAmount?.value !== '30') throw new Error('Smoke update failed: RDS storage amount is not 30GB');
  if (rds.calculationComponents?.columnFormIPM?.value?.[0]?.['Instance Type'] !== 'db.t3.large') throw new Error('Smoke update failed: RDS instance type is not db.t3.large');

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
