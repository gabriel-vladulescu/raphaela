import path from 'node:path';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name} (copy server/.env.example to server/.env)`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  appUrl: process.env.APP_URL ?? 'http://localhost:5173',
  // Cookies marked Secure only when the site is on https: browsers drop Secure cookies on plain http (e.g. the
  // production build opened at http://<this computer's IP>:4400 on the local network), and signing in would fail.
  secureCookies: (process.env.APP_URL ?? '').startsWith('https://'),
  // Where the server listens: localhost in development (Vite faces the network); 0.0.0.0 in production (start.ps1).
  host: process.env.HOST ?? 'localhost',
  // Whose X-Forwarded-For to believe for the visitor's IP: by default a proxy on the same machine (Vite in
  // development, or nginx in front of the app). Set TRUST_PROXY to the proxy's address if it runs elsewhere.
  trustProxy: process.env.TRUST_PROXY ?? 'loopback',
  // Accounts with these emails get the "owner" role when they sign in.
  ownerEmails: (process.env.OWNER_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
  uploadsDir: path.resolve(process.env.UPLOADS_DIR ?? 'uploads'),
  // In production this server also serves the built app (client/dist), with each page's tags put in.
  serveClient: process.env.NODE_ENV === 'production',
  clientDist: path.resolve(process.env.CLIENT_DIST ?? '../client/dist'),
  google: {
    clientId: required('GOOGLE_CLIENT_ID'),
    clientSecret: required('GOOGLE_CLIENT_SECRET'),
    redirectUri: required('GOOGLE_REDIRECT_URI'),
  },
  db: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: required('DB_USER'),
    password: process.env.DB_PASSWORD ?? '',
    database: required('DB_NAME'),
  },
};

export type Config = typeof config;

export const categoryLimits = {
  maxDepth: 3, // category -> sub-category -> sub-sub-category
  maxChildren: 10, // per parent, including the top level
};
