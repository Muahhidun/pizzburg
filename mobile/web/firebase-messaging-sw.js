// Firebase Web configuration and the VAPID key are public client identifiers.
// Keep this SDK version aligned with firebase_core_web.
importScripts(
  'https://www.gstatic.com/firebasejs/12.17.0/firebase-app-compat.js',
);
importScripts(
  'https://www.gstatic.com/firebasejs/12.17.0/firebase-messaging-compat.js',
);

firebase.initializeApp({
  apiKey: 'AIzaSyDJZfAxPxVDOMG5joGrHuvpnzACHW4-8Kk',
  authDomain: 'pizzburg-delivery.firebaseapp.com',
  projectId: 'pizzburg-delivery',
  storageBucket: 'pizzburg-delivery.firebasestorage.app',
  messagingSenderId: '174858068171',
  appId: '1:174858068171:web:029034484eb0008f43fb4e',
});

const messaging = firebase.messaging();

// A notification payload is rendered by FCM automatically. Do not call
// showNotification here, otherwise the browser will display it twice.
messaging.onBackgroundMessage((message) => {
  console.debug('[firebase-messaging-sw] Background message received', message);
});
