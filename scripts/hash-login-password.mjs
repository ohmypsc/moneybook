import { pbkdf2Sync, randomBytes } from "node:crypto";

const password = process.env.MONEYBOOK_PASSWORD || process.argv[2] || "";
if (!password) {
  console.error("사용법: MONEYBOOK_PASSWORD='새 비밀번호' node scripts/hash-login-password.mjs");
  process.exit(1);
}

const iterations = 210_000;
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256");
const value = [
  "pbkdf2-sha256",
  iterations,
  salt.toString("base64url"),
  hash.toString("base64url")
].join("$");

console.log(value);
