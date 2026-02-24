const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: '.env.local' });

async function seed() {
  if (!process.env.MONGODB_URI) {
    console.error("Please ensure MONGODB_URI is set in .env.local!");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['super_admin', 'admin', 'driver'], required: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  }, { timestamps: true });

  const User = mongoose.models.User || mongoose.model('User', UserSchema);

  const passwordHash = await bcrypt.hash('admin123', 10);
  
  await User.findOneAndUpdate(
    { email: 'admin@company.com' },
    {
      name: 'Super Admin',
      email: 'admin@company.com',
      passwordHash,
      role: 'super_admin'
    },
    { upsert: true, new: true }
  );

  console.log("Success! Default admin created: admin@company.com / admin123");
  process.exit(0);
}

seed().catch(console.error);
