// The server's start file for hosts that run Node apps through Phusion Passenger (cPanel's "Setup Node.js App"):
// they start a JavaScript file instead of `npm start`. It reads server/.env (a setting given in the host's panel wins
// over the file), loads TypeScript through tsx (as `npm start` does) and starts src/index.ts, which applies the
// database migrations first. See SETUP.md.
const path = require('node:path');

// uploads/ and ../client/dist are found from here.
process.chdir(__dirname);
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // No .env: the settings come from the host's panel.
}

import('tsx/esm/api')
  .then(({ register }) => {
    register();
    return import('./src/index.ts');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
