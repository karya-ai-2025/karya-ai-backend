const FormData = require('form-data');
const Mailgun = require('mailgun.js');

const mailgun = new Mailgun(FormData);

let _mg = null;

function getClient() {
  if (!_mg) {
    if (!process.env.MAILGUN_API_KEY) {
      throw new Error('MAILGUN_API_KEY is not set in environment variables');
    }
    _mg = mailgun.client({
      username: 'api',
      key: process.env.MAILGUN_API_KEY
    });
  }
  return _mg;
}

const DOMAIN = process.env.MAILGUN_DOMAIN;
const FROM_EMAIL = process.env.MAILGUN_FROM_EMAIL;

const sendEmail = async ({ to, subject, html, text }) => {
  const mg = getClient();
  const messageData = {
    from: FROM_EMAIL,
    to: Array.isArray(to) ? to : [to],
    subject,
    ...(html && { html }),
    ...(text && { text }),
    'o:tracking': 'yes',
    'o:tracking-clicks': 'yes',
    'o:tracking-opens': 'yes'
  };

  const response = await mg.messages.create(DOMAIN, messageData);
  return response;
};

module.exports = { sendEmail, get mg() { return getClient(); }, DOMAIN };
