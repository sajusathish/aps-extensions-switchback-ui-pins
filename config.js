require('dotenv').config();

let {
    APS_CLIENT_ID,
    APS_CLIENT_SECRET,
    APS_CALLBACK_URL,
    PORT,
    SESSION_SECRET
} = process.env;

PORT = PORT || 3000;
APS_CALLBACK_URL = APS_CALLBACK_URL || `http://localhost:${PORT}/auth/callback`;

const missing = [];
if (!APS_CLIENT_ID) missing.push('APS_CLIENT_ID');
if (!APS_CLIENT_SECRET) missing.push('APS_CLIENT_SECRET');
if (!SESSION_SECRET) missing.push('SESSION_SECRET');

if (missing.length > 0) {
    console.error('');
    console.error('Missing environment variables:');
    missing.forEach(name => console.error(`- ${name}`));
    console.error('');
    console.error('Create a .env file in the project root. You can copy .env.example and replace the values.');
    console.error('');
    process.exit(1);
}

module.exports = {
    APS_CLIENT_ID,
    APS_CLIENT_SECRET,
    APS_CALLBACK_URL,
    PORT,
    SESSION_SECRET
};
