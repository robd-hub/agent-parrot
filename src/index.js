// Entry point. Vercel imports the default export; `npm start` runs it as a normal server.
import express from 'express';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { connect } from './db.js';
import { createRoutes } from './routes.js';

const env = process.env;
const isProd = env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production';
const port = Number(env.PORT) || 3000;
const vercelUrl = env.VERCEL_PROJECT_PRODUCTION_URL && `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;

const config = {
  baseUrl: (env.BASE_URL || vercelUrl || `http://localhost:${port}`).replace(/\/$/, ''),
  adminPassword: env.ADMIN_PASSWORD,
  sessionSecret: env.SESSION_SECRET,
  contactEmail: env.CONTACT_EMAIL,
  // Sign-in options. Each button only shows when its keys are set.
  linkedin: { clientId: env.LINKEDIN_CLIENT_ID, clientSecret: env.LINKEDIN_CLIENT_SECRET },
  google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
  github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET },
  // Claude API key for The Daily Hallucination. Without it /news shows plain headlines.
  anthropicApiKey: env.ANTHROPIC_API_KEY,
  // Vercel sends this with its cron calls when it's set, so nobody else can trigger them.
  cronSecret: env.CRON_SECRET,
  // Email: sign-in links and The Squawk. Brevo (free, no domain needed) or Resend.
  brevoApiKey: env.BREVO_API_KEY,
  resendApiKey: env.RESEND_API_KEY,
  emailFrom: env.EMAIL_FROM,
  adminEmail: env.ADMIN_EMAIL,
  // Where grades and grade orders live (Agent Report Card).
  // Free Subgraph Studio key (thegraph.com/studio) for reading the ERC-8004 agent registry. Without it, only the
  // Official MCP Registry is synced. ERC8004_CHAINS picks chains, e.g. "base,ethereum" (default: all four).
  graphApiKey: env.GRAPH_API_KEY,
  githubToken: env.GITHUB_TOKEN,
  erc8004Chains: (env.ERC8004_CHAINS || '').split(',').map((c) => c.trim()).filter(Boolean),
  graderUrl: (env.GRADER_URL || 'https://grader.designimp.com').replace(/\/$/, ''),
  logEmails: !isProd && !env.VERCEL,
  devFakeLogin: !isProd && !env.VERCEL && env.DEV_FAKE_LOGIN === '1',
};

if (!config.sessionSecret) {
  if (isProd) throw new Error('SESSION_SECRET must be set in production');
  config.sessionSecret = randomBytes(32).toString('hex');
  console.warn('SESSION_SECRET not set; using a temporary one (sign-ins reset on restart).');
}
if (!config.adminPassword) console.warn('ADMIN_PASSWORD not set; /admin is locked.');

// Vercel's Postgres (Neon) integration provides DATABASE_URL; locally an embedded database in ./.data is used.
const databaseUrl = env.DATABASE_URL || env.POSTGRES_URL;
if (env.VERCEL && !databaseUrl) throw new Error('DATABASE_URL is not set: connect a Neon database under the project Storage tab');
const db = await connect({ databaseUrl, localDir: env.LOCAL_DB_DIR || './.data/pg' });
const app = express();
app.set('trust proxy', 1);
app.use(createRoutes({ db, config }));
export default app;

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  app.listen(port, () => {
    console.log(`Agent Parrot running at ${config.baseUrl} (port ${port})`);
    if (config.devFakeLogin) console.log('DEV_FAKE_LOGIN is on: sign-in uses a fake test profile.');
  });
}
