const { Firestore } = require('@google-cloud/firestore');
const firestore = new Firestore();

const COLLECTION_NAME = 'subscriptions';

// Get user subscription
async function getUserSubscription(email) {
  const doc = await firestore.collection(COLLECTION_NAME).doc(email).get();
  if (!doc.exists) {
    return null;
  }
  return doc.data();
}

// Update user subscription
async function updateSubscription(email, plan, expiresAt) {
  const data = {
    email,
    plan,
    expiresAt: expiresAt.toISOString(),
    createdAt: new Date().toISOString(),
  };
  await firestore.collection(COLLECTION_NAME).doc(email).set(data);
}

module.exports = { getUserSubscription, updateSubscription };