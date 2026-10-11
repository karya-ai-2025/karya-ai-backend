/**
 * Create (or re-issue) a demo walkthrough account for investors and partners.
 *
 * Usage:
 *   node scripts/createDemoAccount.js                      # random login ID
 *   node scripts/createDemoAccount.js --id acme-capital    # chosen login ID
 *   node scripts/createDemoAccount.js --id acme-capital --label "Acme Capital" --days 30
 *   node scripts/createDemoAccount.js --id acme-capital --reset    # new password, same account
 *   node scripts/createDemoAccount.js --id acme-capital --revoke   # switch the account off
 *   node scripts/createDemoAccount.js --list
 *
 * The password is generated here and printed once — it is stored hashed and
 * can't be read back, only reset. The account signs in at <frontend>/demo, has
 * a sample expert profile, and never appears in the experts directory.
 */

const crypto = require('crypto');
const mongoose = require('mongoose');
const { config } = require('../config/config');
const User = require('../models/User');
const ExpertProfile = require('../models/ExpertProfile');
const { DEMO_EMAIL_DOMAIN } = require('../controllers/authController');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};

// No look-alike characters, so the password survives being read out or retyped
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const randomString = (length, alphabet = ALPHABET) =>
  Array.from({ length }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');

const SAMPLE_PROFILE = {
  headline: 'Former VP Product, streaming & gaming platforms',
  bio: 'Sample profile for the Acerstone walkthrough. Fifteen years building consumer media products across streaming, mobile gaming and ad-tech, most recently leading product for a subscription video service through its first ten million subscribers.',
  yearsOfExperience: 13,
  industries: ['Media', 'Gaming', 'Streaming & OTT', 'Mobile games', 'Advertising & ad-tech'],
  skills: ['Subscription pricing', 'Content licensing', 'Live-ops monetisation', 'Ad-tech stack selection']
    .map((name) => ({ name, level: 'Expert' })),
  location: { city: 'Mumbai', country: 'India' },
  profiling: {
    sector: 'TMEG',
    segments: ['Media', 'Gaming'],
    subSegments: ['Streaming & OTT', 'Mobile games', 'Advertising & ad-tech'],
    functions: ['Product', 'Strategy'],
    seniority: 'VP / Head of',
    currentTitle: 'Independent advisor',
    currentCompany: 'Self-employed',
    experienceBand: '11-15',
    ageBand: '35-44',
    highestQualification: "Master's / MBA",
    topics: ['Subscription pricing', 'Content licensing', 'Live-ops monetisation', 'Ad-tech stack selection'],
    engagementTypes: ['Expert calls', 'Advisory retainers'],
    geographies: ['India', 'Southeast Asia'],
    completedAt: new Date()
  },
  education: [
    { institution: 'Sample Institute of Management', degree: 'MBA', field: 'Strategy', yearFrom: 2009, yearTo: 2011 },
    { institution: 'Sample Institute of Technology', degree: 'B.Tech', field: 'Computer Science', yearFrom: 2003, yearTo: 2007 }
  ],
  experience: [
    { title: 'Independent advisor', company: 'Self-employed', startDate: new Date('2023-01-01'), isCurrent: true },
    { title: 'VP Product', company: 'Sample Streaming Co.', startDate: new Date('2018-01-01'), endDate: new Date('2023-01-01') },
    { title: 'Product Lead', company: 'Sample Games Studio', startDate: new Date('2013-01-01'), endDate: new Date('2018-01-01') }
  ]
};

const describe = (user) => {
  const expiry = user.demo?.expiresAt ? user.demo.expiresAt.toISOString().slice(0, 10) : 'never';
  return `${user.demo?.loginId}  ·  ${user.demo?.label || '—'}  ·  expires ${expiry}  ·  ${user.isActive ? 'active' : 'revoked'}`;
};

async function main() {
  await mongoose.connect(config.mongoUri);

  if (flag('list')) {
    const users = await User.find({ isDemo: true }).sort({ createdAt: -1 });
    console.log(users.length ? users.map(describe).join('\n') : 'No demo accounts yet.');
    return;
  }

  const loginId = (option('id') || `demo-${randomString(6, 'abcdefghjkmnpqrstuvwxyz23456789')}`).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(loginId)) {
    throw new Error('--id must be 3-40 characters: lowercase letters, numbers and dashes');
  }

  const email = `${loginId}@${DEMO_EMAIL_DOMAIN}`;
  let user = await User.findOne({ email });

  if (flag('revoke')) {
    if (!user?.isDemo) throw new Error(`No demo account with ID "${loginId}"`);
    user.isActive = false;
    await user.save({ validateBeforeSave: false });
    console.log(`Revoked: ${loginId}`);
    return;
  }

  if (user && !flag('reset')) {
    throw new Error(`"${loginId}" already exists. Pass --reset to issue a new password for it.`);
  }
  if (user && !user.isDemo) throw new Error(`"${loginId}" belongs to a non-demo account.`);

  const days = parseInt(option('days'), 10);
  const label = option('label');
  const password = `${randomString(5)}-${randomString(5)}-${randomString(5)}`;

  if (!user) {
    user = new User({
      fullName: 'Demo Expert',
      email,
      activeRole: 'expert',
      isEmailVerified: true,
      isDemo: true,
      preferences: { emailNotifications: false, smsNotifications: false, marketingEmails: false },
      onboarding: { expert: { currentStep: 4, completed: true } }
    });
    const profile = await ExpertProfile.create({
      user: user._id,
      ...SAMPLE_PROFILE,
      profileStatus: { isDemo: true, isPublic: false, isSearchable: false }
    });
    user.profiles.expert = profile._id;
    user.hasExpertProfile = true;
  }

  user.password = password; // hashed by the User pre-save hook
  user.isActive = true;
  user.loginAttempts = 0;
  user.lockUntil = undefined;
  user.demo = {
    loginId,
    label: label ?? user.demo?.label,
    expiresAt: days > 0 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : user.demo?.expiresAt
  };
  await user.save();

  console.log('\nDemo access ready — the password is shown only this once.\n');
  console.log(`  Sign in at : ${config.frontendUrl}/demo`);
  console.log(`  Demo ID    : ${loginId}`);
  console.log(`  Password   : ${password}`);
  console.log(`  Expires    : ${user.demo.expiresAt ? user.demo.expiresAt.toISOString().slice(0, 10) : 'never'}\n`);
}

main()
  .catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
