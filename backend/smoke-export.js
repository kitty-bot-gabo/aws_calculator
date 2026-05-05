const EstimateBuilder = require('./lib/estimate-builder');
const { loadSavedEstimate } = require('./lib/aws-client');

async function main() {
  const builder = new EstimateBuilder('Smoke EC2 rehydratable');
  builder.addService('ec2Enhancement', {
    region: 'us-east-1',
    description: 'Smoke EC2 t4g.small',
    instanceType: 't4g.small',
    selectedOS: 'linux',
    quantity: '1',
    tenancy: 'default', // intentionally accepted alias; must normalize to shared
    pricingStrategy: 'ondemand',
    storageType: 'gp2', // intentionally accepted alias; must normalize to AWS Calculator ID
    storageAmount: '30',
  });

  const result = await builder.export();
  const saved = await loadSavedEstimate(result.estimateId);
  const groupServices = Object.values(saved.groups || {}).flatMap(g => Object.values(g.services || {}));
  const services = [...Object.values(saved.services || {}), ...groupServices];
  const ec2 = services.find(s => s.serviceCode === 'ec2Enhancement');
  if (!ec2) throw new Error('Smoke failed: saved estimate does not contain EC2');
  if (!ec2.description || ec2.description === '-') throw new Error('Smoke failed: EC2 description missing');
  if (Object.keys(saved.groups || {}).length) throw new Error('Smoke failed: estimate has an unexpected default group');
  if (ec2.calculationComponents?.tenancy?.value !== 'shared') throw new Error(`Smoke failed: EC2 tenancy is ${ec2.calculationComponents?.tenancy?.value}`);
  if (ec2.calculationComponents?.storageType?.value !== 'Storage General Purpose GB Mo') throw new Error(`Smoke failed: EC2 storageType is ${ec2.calculationComponents?.storageType?.value}`);
  if (!ec2.calculationComponents?.instanceType?.value) throw new Error('Smoke failed: EC2 instanceType missing');

  console.log(JSON.stringify({ ok: true, ...result, savedServiceCount: services.length }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
