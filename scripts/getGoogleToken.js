// scripts/getGoogleToken.js
// Run this ONE TIME to get your Google OAuth refresh token.
// Usage: node scripts/getGoogleToken.js
//
// Before running:
//   1. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env
//   2. Add http://localhost:3000 to your GCP OAuth client's Authorized Redirect URIs
//   3. Run: node scripts/getGoogleToken.js
//   4. Visit the printed URL, approve access
//   5. Copy GOOGLE_REFRESH_TOKEN printed in the terminal into .env

require('dotenv').config();
const http = require('http');
const { google } = require('googleapis');

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI  = 'http://localhost:3001/callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('ERROR: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env');
  process.exit(1);
}

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/meetings.space.readonly', // Meet transcript API
];

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent', // forces refresh_token to be returned even if already authorized
});

console.log('\n======================================================');
console.log('Step 1: Open this URL in your browser:\n');
console.log(authUrl);
console.log('\n======================================================');
console.log('Step 2: Approve the permissions, then wait here...\n');

const server = http.createServer(async (req, res) => {
  const url  = new URL(req.url, 'http://localhost:3001/callback');
  const code = url.searchParams.get('code');
  const err  = url.searchParams.get('error');

  if (err) {
    res.end(`Error: ${err}. Check terminal.`);
    console.error('\nAuthorization error:', err);
    server.close();
    return;
  }

  if (!code) {
    res.end('Waiting...');
    return;
  }

  res.end('<h2>Done! Check your terminal for the refresh token.</h2><p>You can close this tab.</p>');
  server.close();

  try {
    const { tokens } = await oauth2Client.getToken(code);

    console.log('\n✓ Authorization successful! Add these to your .env:\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('\n(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are already in .env)');
    console.log('\nDone! Restart your backend server after updating .env.\n');
  } catch (e) {
    console.error('Failed to exchange code for tokens:', e.message);
  }
});

server.listen(3001, () => {
  console.log('Listening on http://localhost:3001/callback — waiting for Google to redirect...\n');
});
