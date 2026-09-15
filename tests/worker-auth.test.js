import test from "node:test";
import assert from "node:assert/strict";

import {
  createCookie,
  createSessionToken,
  getSession,
  safeEqual,
  verifySessionToken
} from "../worker/auth.js";

const env = {
  SESSION_SECRET: "test-session-secret-that-is-long-enough",
  LOGIN_USERS: JSON.stringify({ 승철: "pw1", 미영: "pw2" })
};

test("safeEqual compares credentials without plain string equality", async () => {
  assert.equal(await safeEqual("same", "same"), true);
  assert.equal(await safeEqual("same", "different"), false);
});

test("session token round-trips and rejects tampering", async () => {
  const token = await createSessionToken("승철", env);
  const payload = await verifySessionToken(token, env);
  assert.equal(payload?.name, "승철");

  const [body, signature] = token.split(".");
  const tamperIndex = Math.min(2, Math.max(0, body.length - 1));
  const replacement = body[tamperIndex] === "A" ? "B" : "A";
  const tamperedBody = `${body.slice(0, tamperIndex)}${replacement}${body.slice(tamperIndex + 1)}`;
  const tampered = `${tamperedBody}.${signature}`;
  assert.equal(await verifySessionToken(tampered, env), null);
});

test("getSession accepts only users still present in LOGIN_USERS", async () => {
  const token = await createSessionToken("승철", env);
  const request = new Request("https://moneybook.example/api/auth/session", {
    headers: { Cookie: `__Host-moneybook_session=${token}` }
  });

  assert.equal((await getSession(request, env))?.name, "승철");
  assert.equal(
    await getSession(request, { ...env, LOGIN_USERS: JSON.stringify({ 미영: "pw2" }) }),
    null
  );
});

test("session cookie keeps strict secure host-only attributes", () => {
  const cookie = createCookie("token");
  assert.match(cookie, /^__Host-moneybook_session=token;/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
});
