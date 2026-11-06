// src/config/firebase.js
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const path = require('path');

const serviceAccount = require(path.join(__dirname, '../../serviceAccountKey.json'));

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount),
  });
}

const messaging = getMessaging();

module.exports = { messaging };