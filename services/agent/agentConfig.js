const identityFields = [
  {
    key: 'name',
    label: 'name',
    question: 'Before we start, let us complete your profile. What is your full name?'
  },
  {
    key: 'email',
    label: 'email',
    question: 'Before we start, let us complete your profile. What email should we use for your Karya AI account?'
  },
  {
    key: 'phone',
    label: 'phone number',
    question: 'Before we start, let us complete your profile. Can you provide your phone number?'
  }
];

const businessFields = [
  {
    key: 'companyName',
    label: 'company name',
    requiredForPlan: true,
    question: 'To complete your business profile, what is your company name?'
  },
  {
    key: 'website',
    label: 'website',
    requiredForPlan: true,
    question: 'To complete your business profile, can you share your company website?'
  },
  {
    key: 'industry',
    label: 'industry',
    requiredForPlan: true,
    question: 'To complete your business profile, what industry is your business in?'
  },
  {
    key: 'targetCustomer',
    label: 'target customer',
    requiredForPlan: true,
    question: 'To complete your business profile, who is your target customer?'
  },
  {
    key: 'channels',
    label: 'sales and marketing channels',
    question: 'To complete your business profile, what sales and marketing channels are you using today?'
  },
  {
    key: 'budget',
    label: 'budget',
    question: 'To complete your business profile, what monthly budget range should we plan around?'
  },
  {
    key: 'constraints',
    label: 'constraints',
    question: 'To complete your business profile, what constraints should we keep in mind?'
  },
  {
    key: 'desiredOutcome',
    label: 'desired outcome',
    question: 'To complete your business profile, what outcome do you want to achieve from Karya AI?'
  }
];

const expertFields = [
  {
    key: 'skills',
    label: 'skills',
    question: 'To complete your expert profile, what are your strongest skills?'
  },
  {
    key: 'industriesServed',
    label: 'industries served',
    question: 'To complete your expert profile, which industries have you served?'
  },
  {
    key: 'projectExperience',
    label: 'project experience',
    question: 'To complete your expert profile, what project experience should we highlight?'
  },
  {
    key: 'availability',
    label: 'availability',
    question: 'To complete your expert profile, what is your current availability?'
  },
  {
    key: 'capacity',
    label: 'capacity',
    question: 'To complete your expert profile, how many hours per week can you take on?'
  },
  {
    key: 'preferredProjectTypes',
    label: 'preferred project types',
    question: 'To complete your expert profile, what project types do you prefer?'
  },
  {
    key: 'portfolioProof',
    label: 'portfolio or proof',
    question: 'To complete your expert profile, can you share a portfolio link, case study, or proof of work?'
  }
];

module.exports = {
  identityFields,
  businessFields,
  expertFields
};
