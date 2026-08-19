// Dev-only helper: prints a next-auth session cookie for a real user so a
// headless browser can load authenticated pages while debugging.
// Usage: node -r dotenv/config scripts/dev-mint-session.mjs dotenv_config_path=.env.local [--report] [--email x]
import "dotenv/config";
import mongoose from "mongoose";
import { encode } from "next-auth/jwt";

const argv = process.argv.slice(2);
const wantReport = argv.includes("--report");
const emailArg = argv[argv.indexOf("--email") + 1];

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection;

if (wantReport) {
  const names = (await db.db.listCollections().toArray()).map((c) => c.name);
  for (const n of names) {
    const count = await db.collection(n).countDocuments();
    console.error(`${n}: ${count}`);
  }
  const byCompany = await db
    .collection("users")
    .find({}, { projection: { email: 1, role: 1, companyId: 1 } })
    .limit(30)
    .toArray();
  console.error(JSON.stringify(byCompany, null, 2));
}

const users = db.collection("users");
const user = emailArg
  ? await users.findOne({ email: emailArg })
  : (await users.findOne({ role: "superadmin" })) ||
    (await users.findOne({ role: "admin" })) ||
    (await users.findOne({}));

if (!user) {
  console.error("no users found");
  process.exit(1);
}

const token = await encode({
  token: {
    name: user.name,
    email: user.email,
    sub: user._id.toString(),
    id: user._id.toString(),
    role: user.role,
    companyId: user.companyId ? user.companyId.toString() : null,
  },
  secret: process.env.NEXTAUTH_SECRET,
  maxAge: 60 * 60,
});

console.log(JSON.stringify({ email: user.email, role: user.role, token }));
await mongoose.disconnect();
