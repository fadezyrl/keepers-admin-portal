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
    // Lazy require so local/dev without firebase-admin still boots if package missing.
    // eslint-disable-next-line global-require
    const firebaseAdmin = require('firebase-admin');
    if (firebaseAdmin.apps.length) {
      admin = firebaseAdmin.app();
      return admin;
    }

    const serviceAccount = loadServiceAccount();
    if (!serviceAccount) {
      initError = 'Firebase Admin credentials not configured';
      return null;
    }

    admin = firebaseAdmin.initializeApp({
      credential: firebaseAdmin.credential.cert(serviceAccount),
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

module.exports = {
  getFirebaseAdmin,
  isFirebaseReady,
  getFirebaseInitError,
};
