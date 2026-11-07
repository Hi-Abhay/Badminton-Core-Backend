// // src/config/firebase.js
// const { initializeApp, cert, getApps } = require('firebase-admin/app');
// const { getMessaging } = require('firebase-admin/messaging');
// const path = require('path');

// const serviceAccount = require(path.join(__dirname, '../../serviceAccountKey.json'));

// if (!getApps().length) {
//   initializeApp({
//     credential: cert(serviceAccount),
//   });
// }

// const messaging = getMessaging();

// module.exports = { messaging };


// src/config/firebase.js

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

const {
  FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY,
} = process.env;

// Validate Firebase environment variables
if (
  !FIREBASE_PROJECT_ID ||
  !FIREBASE_CLIENT_EMAIL ||
  !FIREBASE_PRIVATE_KEY
) {
  throw new Error(
    'Firebase Admin credentials are missing. Please check your .env file.'
  );
}

// Restore private key line breaks
const privateKey = FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');

// Initialize Firebase only once
const firebaseApp = getApps().length
  ? getApps()[0]
  : initializeApp({
      credential: cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
    });

// Get Firebase Messaging instance
const messaging = getMessaging(firebaseApp);

module.exports = { messaging };
