# Firebase Cloud Messaging (Keepers)

## Architecture

1. Business actions call `createNotification` / `notifyMany` in `backend/src/services/notificationService.js`.
2. Rows are inserted into Supabase `notifications` (in-app centre).
3. Best-effort FCM push is sent via Firebase Admin SDK using active `device_tokens`.
4. Push failures never fail the business API response.

## Required setup

### 1. Database

```bash
cd backend
npm run migrate
```

Applies `008_device_tokens_and_push.sql`.

### 2. Firebase Admin (backend)

1. Firebase Console → Project settings → Service accounts → Generate new private key.
2. Store the JSON **outside git** (e.g. `backend/secrets/firebase-service-account.json`).
3. Set one of:
   - `FIREBASE_SERVICE_ACCOUNT_PATH=./secrets/firebase-service-account.json`
   - `FIREBASE_SERVICE_ACCOUNT_JSON=...`
   - `FIREBASE_SERVICE_ACCOUNT_BASE64=...`
4. `FIREBASE_PROJECT_ID=keepers-68d3e`

Never put the service account in the mobile app or Admin Portal frontend env.

### 3. Android app

- Package: `com.keepers`
- File: `android/app/google-services.json` (already present for project `keepers-68d3e`)
- Gradle Google Services plugin applied
- Packages: `@react-native-firebase/app`, `@react-native-firebase/messaging`
- Rebuild: `npx react-native run-android`

### 4. iOS app (external blockers)

Still required before iOS push works:

1. Register an iOS app in Firebase with bundle id `com.keepers`.
2. Download `GoogleService-Info.plist` into `ios/keepers/`.
3. Upload an APNs auth key (`.p8`) in Firebase Console → Cloud Messaging.
4. Xcode → Signing & Capabilities → Push Notifications + Background Modes (Remote notifications).
5. `cd ios && pod install`
6. Test on a **real iPhone** (simulator cannot fully verify APNs).

Until those are done, iOS push is **blocked by external configuration**.

## Mobile API

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/content/notifications/devices/register` | Upsert FCM token |
| DELETE | `/api/content/notifications/devices/:id` | Deactivate one device |
| POST | `/api/content/notifications/devices/deactivate` | Logout / token cleanup |
| GET | `/api/content/notifications` | In-app list |
| POST | `/api/content/notifications/:id/read` | Mark read |
| POST | `/api/content/notifications/read-all` | Mark all read |

## Local tests

```bash
cd backend
npm test
```

These tests mock Firebase Admin. They do **not** prove physical device delivery.
