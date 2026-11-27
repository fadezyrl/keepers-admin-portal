const fs = require('fs');
const path = require('path');
const { env } = require('./env');

let admin = null;
let initAttempted = false;
let initError = null;

function loadServiceAccount() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawJson) {
    return JSON.parse(rawJson);
  }

  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (b64) {
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  }

  const filePath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (filePath) {
    const resolved = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  }

  return null;
}

function getFirebaseAdmin() {
  if (initAttempted) return admin;
  initAttempted = true;

  try {
    // firebase-admin v12+ modular surface: getApps/getApp (legacy `.apps` removed).
    // eslint-disable-next-line global-require
    const firebaseAdmin = require('firebase-admin');
    const getApps =
      typeof firebaseAdmin.getApps === 'function' ? firebaseAdmin.getApps : null;
    const getApp =
      typeof firebaseAdmin.getApp === 'function' ? firebaseAdmin.getApp : null;
    const initializeApp =
      typeof firebaseAdmin.initializeApp === 'function'
        ? firebaseAdmin.initializeApp
        : null;
    const cert =
      typeof firebaseAdmin.cert === 'function'
        ? firebaseAdmin.cert
        : firebaseAdmin.credential?.cert;

    if (!initializeApp || !cert) {
      initError = 'firebase-admin initializeApp/cert unavailable';
      return null;
    }

    const existing =
      getApps && getApps().length
        ? getApp
          ? getApp()
          : getApps()[0]
        : firebaseAdmin.apps?.length
          ? firebaseAdmin.app()
          : null;
    if (existing) {
      admin = existing;
      return admin;
    }

    const serviceAccount = loadServiceAccount();
    if (!serviceAccount) {
      initError = 'Firebase Admin credentials not configured';
      return null;
    }

    admin = initializeApp({
      credential: cert(serviceAccount),
      projectId:
        serviceAccount.project_id ||
        process.env.FIREBASE_PROJECT_ID ||
        env.firebaseProjectId ||
        'keepers-68d3e',
    });
    return admin;
  } catch (err) {
    initError = err.message || 'Firebase Admin init failed';
    admin = null;
    return null;
  }
}

function isFirebaseReady() {
  return Boolean(getFirebaseAdmin());
}

function getFirebaseInitError() {
  return initError;
}

/**
 * firebase-admin v14: messaging lives on `firebase-admin/messaging` (no app.messaging()).
 */
function getFirebaseMessaging() {
  const app = getFirebaseAdmin();
  if (!app) return null;
  try {
    // eslint-disable-next-line global-require
    const { getMessaging } = require('firebase-admin/messaging');
    return getMessaging(app);
  } catch (err) {
    initError = err.message || 'Firebase Messaging unavailable';
    return null;
  }
}

/** Reset cached init — used by diagnostics/tests only. */
function __resetFirebaseForTests() {
  admin = null;
  initAttempted = false;
  initError = null;
}

module.exports = {
  getFirebaseAdmin,
  getFirebaseMessaging,
  isFirebaseReady,
  getFirebaseInitError,
  __resetFirebaseForTests,
};
