// src/auth/auth.js
import { config } from "../amplifyConfig";
import { randomString, pkceChallengeFromVerifier } from "./pkce";

const LS_KEY = "bio_tokens_v1";
const SS_VERIFIER = "pkce_verifier_v1";
const SS_STATE = "oauth_state_v1";

function isProd() {
  return window.location.origin.startsWith("https://");
}

function redirectUri() {
  return isProd() ? config.redirectUriProd : config.redirectUriDev;
}

function saveTokens(tokens) {
  localStorage.setItem(LS_KEY, JSON.stringify(tokens));
}

function loadTokens() {
  const raw = localStorage.getItem(LS_KEY);
  return raw ? JSON.parse(raw) : null;
}

function clearTokens() {
  localStorage.removeItem(LS_KEY);
}

function parseJwt(token) {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function getIdToken() {
  return loadTokens()?.id_token || null;
}

export function getAccessToken() {
  return loadTokens()?.access_token || null;
}

export function getUserInfo() {
  const idt = getIdToken();
  return idt ? parseJwt(idt) : null;
}

export function getGroups() {
  const info = getUserInfo();
  // cognito:groups puede venir como array
  return info?.["cognito:groups"] || [];
}

export function isAdmin() {
  return getGroups().includes("admin");
}

export async function signIn() {
  // PKCE
  const verifier = randomString(64);
  const challenge = await pkceChallengeFromVerifier(verifier);

  sessionStorage.setItem(SS_VERIFIER, verifier);

  // state anti-CSRF
  const state = randomString(24);
  sessionStorage.setItem(SS_STATE, state);

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    scope: config.scopes.join(" "),
    redirect_uri: redirectUri(),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  window.location.href = `${config.cognitoDomain}/login?${params.toString()}`;
}

export function signOut() {
  clearTokens();
  sessionStorage.removeItem(SS_VERIFIER);
  sessionStorage.removeItem(SS_STATE);

  const params = new URLSearchParams({
    client_id: config.clientId,
    logout_uri: redirectUri(),
  });

  window.location.href = `${config.cognitoDomain}/logout?${params.toString()}`;
}

export async function handleCallbackIfPresent() {
  const url = new URL(window.location.href);

  // Si Cognito devolvió error
  const err = url.searchParams.get("error");
  const errDesc = url.searchParams.get("error_description");
  if (err) {
    return { ok: false, error: `${err}: ${errDesc || ""}`.trim() };
  }

  const code = url.searchParams.get("code");
  if (!code) return { ok: true, didHandle: false };

  const returnedState = url.searchParams.get("state") || "";
  const expectedState = sessionStorage.getItem(SS_STATE) || "";
  if (!expectedState || returnedState !== expectedState) {
    return { ok: false, error: "State mismatch (posible sesión/ventana diferente). Vuelve a Sign in." };
  }

  const verifier = sessionStorage.getItem(SS_VERIFIER);
  if (!verifier) {
    return { ok: false, error: "Missing pkce_verifier (try sign in again)" };
  }

  // Intercambio code -> tokens (token endpoint)
  const tokenUrl = `${config.cognitoDomain}/oauth2/token`;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });

  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!resp.ok) {
    const txt = await resp.text();
    return { ok: false, error: `Token exchange failed (${resp.status}): ${txt}` };
  }

  const tokens = await resp.json();
  saveTokens(tokens);

  // Limpia querystring (?code=...)
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  url.searchParams.delete("session_state");
  url.searchParams.delete("error");
  url.searchParams.delete("error_description");
  window.history.replaceState({}, document.title, url.pathname);

  return { ok: true, didHandle: true };
}

export function isLoggedIn() {
  const t = loadTokens();
  return !!(t?.id_token && t?.access_token);
}
