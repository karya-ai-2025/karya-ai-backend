/**
 * Fill a LOCAL development database with the reference data the app needs to
 * be clicked through: the project catalog (+ pricing tiers), plans with
 * packages, and credit costs. No users, no customer data.
 *
 * Usage (from the backend folder):
 *   ENV_FILE=.env.local node scripts/seedLocalCatalog.js
 *
 * Safe to re-run: it upserts by slug / name / actionType.
 *
 * Refuses to run unless the database is on this machine, so it can never
 * touch the shared database in .env. The catalog comes from
 * scripts/seed-data/projectCatalog.local.json (exported from the frontend's
 * src/app/project-marketplace/projects.js); prices are placeholders for local
 * testing, not the real price list.
 */

const mongoose = require('mongoose');
const { config } = require('../config/config');
const ProjectCatalog = require('../models/ProjectCatalog');
const ProjectPricing = require('../models/ProjectPricing');
const Plan = require('../models/Plan');
const PlanPackage = require('../models/PlanPackage');
const CreditCost = require('../models/CreditCost');
const catalog = require('./seed-data/projectCatalog.local.json');

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

function assertLocal(uri) {
  let host;
  try {
    host = new URL(uri).hostname;
  } catch {
    host = '';
  }
  if (!uri.startsWith('mongodb://') || !LOCAL_HOSTS.includes(host)) {
    throw new Error(
      `Refusing to seed ${host || 'this database'}: only a database on this machine may be seeded.\n` +
      'Run with ENV_FILE=.env.local so MONGODB_URI points at your local MongoDB.'
    );
  }
}

const TIERS = [
  { tierId: 'credit', name: 'Credits',  displayOrder: 1, price: { amount: 0,     billingCycle: 'per-unit', label: 'Pay with credits', note: 'Uses platform credits' } },
  { tierId: 'bronze', name: 'Bronze',   displayOrder: 2, price: { amount: 15000, billingCycle: 'monthly',  label: '₹15,000/mo' } },
  { tierId: 'silver', name: 'Silver',   displayOrder: 3, popular: true, badge: 'Recommended', price: { amount: 45000, billingCycle: 'monthly', label: '₹45,000/mo' } },
  { tierId: 'gold',   name: 'Gold',     displayOrder: 4, price: { amount: 90000, billingCycle: 'monthly',  label: '₹90,000/mo' } },
];

const PLANS = [
  {
    plan: { name: 'startups', type: 'startups_solopreneurs', displayName: 'Startups & Solopreneurs', isActive: true },
    packages: [
      { name: 'Starter', price: 4999,  credits: 500,  projectsAvailable: 1, billingCycle: 'monthly', support: 'Email' },
      { name: 'Growth',  price: 14999, credits: 2000, projectsAvailable: 3, billingCycle: 'monthly', support: 'Priority email' },
    ],
  },
  {
    plan: { name: 'enterprise', type: 'enterprise', displayName: 'Enterprise', isActive: true },
    packages: [
      { name: 'Scale', price: 49999, credits: 10000, projectsAvailable: 10, billingCycle: 'monthly', support: 'Dedicated manager' },
    ],
  },
];

const CREDIT_COSTS = [
  { actionType: 'VIEW_EMAIL',     credits: 1, description: 'View email address of a lead' },
  { actionType: 'VIEW_PHONE',     credits: 3, description: 'View phone number of a lead' },
  { actionType: 'DOWNLOAD_LEADS', credits: 1, description: 'Download lead data (per lead)' },
];

async function main() {
  assertLocal(config.mongoUri);
  await mongoose.connect(config.mongoUri);
  console.log(`Seeding ${config.mongoUri}`);

  for (const project of catalog) {
    const doc = await ProjectCatalog.findOneAndUpdate(
      { slug: project.slug },
      { $set: project },
      { upsert: true, returnDocument: 'after', runValidators: true }
    );
    for (const tier of TIERS) {
      await ProjectPricing.findOneAndUpdate(
        { projectId: doc._id, tierId: tier.tierId },
        { $set: { ...tier, projectId: doc._id } },
        { upsert: true, runValidators: true }
      );
    }
  }
  console.log(`  ${catalog.length} catalog projects, ${TIERS.length} pricing tiers each`);

  for (const { plan, packages } of PLANS) {
    const p = await Plan.findOneAndUpdate({ name: plan.name }, { $set: plan }, { upsert: true, returnDocument: 'after' });
    for (const pkg of packages) {
      await PlanPackage.findOneAndUpdate(
        { planId: p._id, name: pkg.name },
        { $set: { ...pkg, planId: p._id, isActive: true } },
        { upsert: true, runValidators: true }
      );
    }
  }
  console.log(`  ${PLANS.length} plans with packages`);

  for (const cost of CREDIT_COSTS) {
    await CreditCost.findOneAndUpdate(
      { actionType: cost.actionType },
      { $set: { ...cost, isActive: true } },
      { upsert: true }
    );
  }
  console.log(`  ${CREDIT_COSTS.length} credit costs`);

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch(async (err) => {
  console.error(err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
