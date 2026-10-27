// Saves chatbot conversations to MongoDB (collection: chat_logs), as in the project design.
// Only runs when MONGODB_URI is set. If MongoDB is down, the chatbot keeps working.
let collection; // undefined = not tried yet, null = not available

async function getCollection() {
  if (collection !== undefined) return collection;
  if (!process.env.MONGODB_URI) return (collection = null);
  try {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    // Atlas links usually have no database name, so default to hmf
    collection = client.db(process.env.MONGODB_DB || 'hmf').collection('chat_logs');
  } catch (e) {
    console.error('MongoDB chat log not available:', e.message);
    collection = null;
  }
  return collection;
}

async function logChat(entry) {
  try {
    const col = await getCollection();
    if (col) await col.insertOne({ ...entry, created_at: new Date() });
  } catch (e) {
    console.error('Could not save chat log:', e.message);
  }
}

module.exports = { logChat };
