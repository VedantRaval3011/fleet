// Node resolve hook so standalone scripts can import app modules written for
// Next.js: maps "@/x" to "src/x" and fills in the ".ts"/".tsx"/"/index.ts" that
// the bundler normally infers. Registered by ts-alias-register.mjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const EXTS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function withExtension(file) {
  if (path.extname(file) && fs.existsSync(file)) return file;
  for (const ext of EXTS) {
    if (fs.existsSync(file + ext)) return file + ext;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const file = withExtension(path.join(srcDir, specifier.slice(2)));
    if (file) return next(pathToFileURL(file).href, context);
  } else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const file = withExtension(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
    if (file) return next(pathToFileURL(file).href, context);
  }
  return next(specifier, context);
}
