const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { env, assertRuntimeConfig } = require('./config/env');
const routes = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { createChatSocketServer } = require('./realtime/chatSocket');
const { initPresenceStore } = require('./services/presenceStore');

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.corsOrigins.includes(origin) || env.nodeEnv === 'development') {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

app.use(
  '/api/auth/login',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.use(
  '/api',
  rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.use('/api', routes);
app.use(notFoundHandler);
app.use(errorHandler);

async function start() {
  const missing = assertRuntimeConfig();
  if (missing.length) {
    console.warn('[boot] Missing env vars (Auth/Storage features will be limited):', missing.join(', '));
  } else {
    console.log('[boot] Supabase Auth/Storage env configured');
  }

  if (!env.databaseUrl) {
    console.error('[boot] DATABASE_URL / database_url is required');
    process.exit(1);
  }

  const presence = await initPresenceStore();
  console.log(`[boot] Chat presence mode: ${presence.mode}`);

  const server = http.createServer(app);
  createChatSocketServer(server, { corsOrigins: env.corsOrigins });

  server.listen(env.port, '0.0.0.0', () => {
    console.log(`[boot] Keepers API + Socket.IO listening on 0.0.0.0:${env.port}`);
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error('[boot] Failed to start', err);
    process.exit(1);
  });
}

module.exports = { app, start };
