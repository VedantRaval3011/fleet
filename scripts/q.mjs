// Dev-only: mint a session cookie for an arbitrary companyId so debugging can
// exercise pages against companies that actually have GPS data.
import "dotenv/config";
import mongoose from "mongoose";
import { encode } from "next-auth/jwt";

const companyId = process.argv[2];
await mongoose.connect(process.env.MONGODB_URI);
const user = await mongoose.connection.collection("users").findOne({ role: "admin" });

const token = await encode({
  token: {
    name: user.name,
    email: user.email,
    sub: user._id.toString(),
    id: user._id.toString(),
    role: "admin",
    companyId,
  },
  secret: process.env.NEXTAUTH_SECRET,
  maxAge: 60 * 60,
});
console.log(token);
await mongoose.disconnect();
