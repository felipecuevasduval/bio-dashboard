import React, { useEffect, useMemo, useState } from "react";
import { createPkcePair } from "./auth/pkce";

const COG_DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN;
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID;
const API_BASE = import.meta.env.VITE_API_BASE;

function redirectUri() {
  return window.location.hostname === "localhost"
    ? import.meta.env.VITE_REDIRECT_URI_DEV
    : import.meta.env.VITE_REDIRECT_URI_PROD;
}

function parseJwt(token) {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    return null;
  }
}

function isAdminFromIdToken(idToken) {
  const c = parseJwt(idToken);
  const groups = c?.["cognito:groups"];
  if (!groups) return false;
  if (typeof groups === "string") return groups.split(",").map(s => s.trim()).includes("admin");
  if (Array.isArray(groups)) return groups.includes("admin");
  return false;
}

async function exchangeCodeForTokens(code) {
  const verifier = sessionStorage.getItem("pkce_verifier");
  if (!verifier) throw new Error("Missing pkce_verifier (try sign in again)");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });

  const res = await fetch(`${COG_DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${txt}`);
  }

  return res.json(); // { id_token, access_token, refresh_token, expires_in, token_type }
}

function saveTokens(tok) {
  localStorage.setItem("id_token", tok.id_token);
  localStorage.setItem("access_token", tok.access_token);
  localStorage.setItem("expires_in", String(tok.expires_in || ""));
  localStorage.setItem("token_type", tok.token_type || "Bearer");
}

function getIdToken() {
  return localStorage.getItem("id_token");
}

function signOut() {
  localStorage.removeItem("id_token");
  localStorage.removeItem("access_token");
  // Hosted UI logout:
  const url =
    `${COG_DOMAIN}/logout?client_id=${CLIENT_ID}` +
    `&logout_uri=${encodeURIComponent(redirectUri())}`;
  window.location.href = url;
}

async function apiGet(path) {
  const idToken = getIdToken();
  if (!idToken) throw new Error("Not signed in");
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`API error ${res.status}: ${txt}`);
  }
  return res.json();
}

async function apiPut(path, payload) {
  const idToken = getIdToken();
  if (!idToken) throw new Error("Not signed in");
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`API error ${res.status}: ${txt}`);
  }
  return res.json();
}

export default function App() {
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(false);

  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [meas, setMeas] = useState([]);
  const [patientName, setPatientName] = useState("");

  const idToken = getIdToken();
  const isAdmin = useMemo(() => (idToken ? isAdminFromIdToken(idToken) : false), [idToken]);

  // 1) Handle callback: ?code=...
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const code = qs.get("code");
    const err = qs.get("error");
    const errDesc = qs.get("error_description");

    if (err) {
      setAuthError(`${err}: ${errDesc || ""}`);
      return;
    }
    if (!code) return;

    (async () => {
      try {
        setLoading(true);
        const tok = await exchangeCodeForTokens(code);
        saveTokens(tok);
        sessionStorage.removeItem("pkce_verifier");
        sessionStorage.removeItem("pkce_challenge");

        // clean URL
        window.history.replaceState({}, document.title, "/");
        setAuthError("");
        setLoading(false);
      } catch (e) {
        setLoading(false);
        setAuthError(String(e.message || e));
      }
    })();
  }, []);

  // 2) After login, load devices
  useEffect(() => {
    if (!getIdToken()) return;
    (async () => {
      try {
        setLoading(true);
        const d = await apiGet("/devices");
        setDevices(d.items || []);
        setLoading(false);
      } catch (e) {
        setLoading(false);
        setAuthError(String(e.message || e));
      }
    })();
  }, [idToken]);

  // 3) When select device, fetch measurements + fill patientName from devices table
  useEffect(() => {
    if (!selectedDevice) return;
    const dev = devices.find(x => x.device_id === selectedDevice);
    setPatientName(dev?.patient_name || "");

    (async () => {
      try {
        setLoading(true);
        const r = await apiGet(`/measurements?device_id=${encodeURIComponent(selectedDevice)}&limit=300`);
        setMeas(r.items || []);
        setLoading(false);
      } catch (e) {
        setLoading(false);
        setAuthError(String(e.message || e));
      }
    })();
  }, [selectedDevice, devices]);

  async function onSignIn() {
    setAuthError("");
    const { verifier, challenge } = await createPkcePair();
    sessionStorage.setItem("pkce_verifier", verifier);
    sessionStorage.setItem("pkce_challenge", challenge);

    const url =
      `${COG_DOMAIN}/login?client_id=${CLIENT_ID}` +
      `&response_type=code` +
      `&scope=email+openid` +
      `&redirect_uri=${encodeURIComponent(redirectUri())}` +
      `&code_challenge=${encodeURIComponent(challenge)}` +
      `&code_challenge_method=S256`;

    window.location.href = url;
  }

  async function onSavePatientName() {
    if (!selectedDevice) return;
    try {
      setLoading(true);
      await apiPut(`/devices/${encodeURIComponent(selectedDevice)}`, { patient_name: patientName });
      // refresh devices
      const d = await apiGet("/devices");
      setDevices(d.items || []);
      setLoading(false);
    } catch (e) {
      setLoading(false);
      setAuthError(String(e.message || e));
    }
  }

  const signedIn = !!getIdToken();

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, Arial" }}>
      <h1>Bio Dashboard</h1>

      {!signedIn ? (
        <>
          <button onClick={onSignIn} style={{ padding: "10px 14px" }}>Sign in</button>
          {authError ? <p style={{ color: "tomato" }}>{authError}</p> : null}
          <p style={{ opacity: 0.7, marginTop: 10 }}>
            Dev redirect: {import.meta.env.VITE_REDIRECT_URI_DEV}
          </p>
        </>
      ) : (
        <>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button onClick={signOut} style={{ padding: "8px 12px" }}>Sign out</button>
            <span style={{ opacity: 0.8 }}>
              Role: <b>{isAdmin ? "admin" : "viewer"}</b>
            </span>
          </div>

          {authError ? <p style={{ color: "tomato" }}>{authError}</p> : null}
          {loading ? <p>Loading...</p> : null}

          <hr style={{ margin: "16px 0" }} />

          <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ minWidth: 320 }}>
              <h3>Devices</h3>
              <select
                value={selectedDevice}
                onChange={(e) => setSelectedDevice(e.target.value)}
                style={{ width: "100%", padding: 8 }}
              >
                <option value="">-- Select device --</option>
                {devices.map((d) => (
                  <option key={d.device_id} value={d.device_id}>
                    {d.patient_name ? `${d.patient_name} — ` : ""}{d.device_id}
                  </option>
                ))}
              </select>

              {selectedDevice && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ opacity: 0.8 }}>Device:</div>
                  <div style={{ fontFamily: "monospace" }}>{selectedDevice}</div>

                  <div style={{ marginTop: 12 }}>
                    <div style={{ opacity: 0.8 }}>Patient name (admin only):</div>
                    <input
                      value={patientName}
                      onChange={(e) => setPatientName(e.target.value)}
                      disabled={!isAdmin}
                      placeholder="e.g., Juan Perez"
                      style={{ width: "100%", padding: 8, marginTop: 6 }}
                    />
                    <button
                      onClick={onSavePatientName}
                      disabled={!isAdmin}
                      style={{ marginTop: 8, padding: "8px 12px" }}
                    >
                      Save
                    </button>
                    {!isAdmin ? <p style={{ opacity: 0.6 }}>Viewer cannot edit</p> : null}
                  </div>
                </div>
              )}
            </div>

            <div style={{ minWidth: 520, flex: 1 }}>
              <h3>Telemetry (last {meas.length})</h3>

              {meas.length === 0 ? (
                <p style={{ opacity: 0.7 }}>Select a device to load measurements.</p>
              ) : (
                <>
                  <SimpleSparkline
                    title="HR"
                    data={meas.map(x => Number(x.hr || 0))}
                  />
                  <SimpleSparkline
                    title="EDA"
                    data={meas.map(x => Number(x.eda || 0))}
                  />

                  <div style={{ marginTop: 12, overflowX: "auto" }}>
                    <table cellPadding="6" style={{ borderCollapse: "collapse", width: "100%" }}>
                      <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid #444" }}>
                          <th>ts</th>
                          <th>hr</th>
                          <th>eda</th>
                          <th>seq</th>
                        </tr>
                      </thead>
                      <tbody>
                        {meas.slice(-20).map((r, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid #222" }}>
                            <td>{r.ts}</td>
                            <td>{r.hr}</td>
                            <td>{r.eda}</td>
                            <td>{r.seq}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SimpleSparkline({ title, data }) {
  const w = 520, h = 120, pad = 10;
  const filtered = data.filter(v => Number.isFinite(v));
  const min = Math.min(...filtered);
  const max = Math.max(...filtered);
  const span = max - min || 1;

  const pts = filtered.map((v, i) => {
    const x = pad + (i * (w - 2 * pad)) / Math.max(filtered.length - 1, 1);
    const y = h - pad - ((v - min) * (h - 2 * pad)) / span;
    return `${x},${y}`;
  }).join(" ");

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", opacity: 0.9 }}>
        <b>{title}</b>
        <span style={{ fontFamily: "monospace", opacity: 0.8 }}>min={min.toFixed(2)} max={max.toFixed(2)}</span>
      </div>
      <svg width={w} height={h} style={{ background: "#111", borderRadius: 8 }}>
        <polyline fill="none" stroke="white" strokeWidth="2" points={pts} />
      </svg>
    </div>
  );
}
