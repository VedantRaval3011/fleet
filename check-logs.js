const mongoose = require('mongoose');
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  
  const docs = await db.collection('calllogs').find({}).limit(5).toArray();
  fs.writeFileSync('sample_logs.json', JSON.stringify(docs, null, 2));
  
  process.exit(0);
}

check().catch(console.error);
