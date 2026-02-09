// src/auth/pkce.js

function base64UrlEncode(arr) {
  return btoa(String.fromCharCode(...new Uint8Array(arr)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function randomString(len = 64) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  // convierte a texto seguro
  return base64UrlEncode(bytes).slice(0, len);
}

export async function sha256(input) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash);
}

export async function pkceChallengeFromVerifier(verifier) {
  const hashed = await sha256(verifier);
  return base64UrlEncode(hashed);
}
