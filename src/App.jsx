// src/App.jsx
import { useEffect, useMemo, useState } from "react";
import { config } from "./amplifyConfig";
import {
  signIn,
  signOut,
  handleCallbackIfPresent,
  isLoggedIn,
  getIdToken,
  getUserInfo,
  isAdmin,
} from "./auth/auth";

async function apiFetch(path, { method = "GET", body } = {}) {
  const token = getIdToken(); // normalmente JWT authorizer acepta id_token
  const url = `${config.apiBaseUrl}${path}`;

  const resp = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`${resp.status} ${resp.statusText}: ${txt}`);
  }

  // si no hay body
  const ct = resp.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return null;
  return await resp.json();
}

export default function App() {
  const [authError, setAuthError] = useState("");
  const [logged, setLogged] = useState(isLoggedIn());

  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState("");
  const [patientName, setPatientName] = useState("");

  const [measurements, setMeasurements] = useState([]);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState("");

  const user = useMemo(() => getUserInfo(), [logged]);

  // 1) Capturar callback de Cognito al cargar
  useEffect(() => {
    (async () => {
      const r = await handleCallbackIfPresent();
      if (!r.ok) {
        setAuthError(r.error || "Auth error");
      } else {
        setAuthError("");
      }
      setLogged(isLoggedIn());
    })();
  }, []);

  // 2) Cargar devices al loguear
  useEffect(() => {
    if (!logged) return;
    (async () => {
      setApiError("");
      try {
        const data = await apiFetch("/devices");
        // Esperado: [{device_id, thing_name, patient_id, patient_name?}, ...]
        setDevices(Array.isArray(data) ? data : (data?.items || []));
      } catch (e) {
        setApiError(String(e.message || e));
      }
    })();
  }, [logged]);

  // 3) Cuando seleccionas device, carga patientName actual y measurements
  useEffect(() => {
    if (!logged || !deviceId) return;

    const d = devices.find(x => x.device_id === deviceId);
    setPatientName(d?.patient_name || d?.patient_id || "");

    (async () => {
      setLoading(true);
      setApiError("");
      try {
        // Ejemplo de querystring: ajusta si tu API no lo usa
        const data = await apiFetch(`/measurements?device_id=${encodeURIComponent(deviceId)}&limit=200`);
        // Esperado: [{ts, hr, eda, ...}, ...]
        const items = Array.isArray(data) ? data : (data?.items || []);
        setMeasurements(items);
      } catch (e) {
        setApiError(String(e.message || e));
      } finally {
        setLoading(false);
      }
    })();
  }, [logged, deviceId, devices]);

  async function savePatientName() {
    if (!deviceId) return;
    setApiError("");
    try {
      await apiFetch(`/devices/${encodeURIComponent(deviceId)}`, {
        method: "PUT",
        body: { patient_name: patientName },
      });

      // refresca lista local
      setDevices(prev =>
        prev.map(d => (d.device_id === deviceId ? { ...d, patient_name: patientName } : d))
      );
    } catch (e) {
      setApiError(String(e.message || e));
    }
  }

  return (
    <div style={{ maxWidth: 980, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
      <h1>Bio Dashboard</h1>

      {!logged ? (
        <>
          <button onClick={() => signIn()} style={{ padding: "10px 14px" }}>
            Sign in
          </button>

          {authError && (
            <div style={{ marginTop: 12, color: "tomato" }}>
              {authError}
              <div style={{ marginTop: 8, opacity: 0.7 }}>
                Dev redirect: {config.redirectUriDev}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button onClick={() => signOut()} style={{ padding: "10px 14px" }}>
              Sign out
            </button>
            <div style={{ opacity: 0.8 }}>
              Usuario: <b>{user?.email || user?.["cognito:username"] || "—"}</b>{" "}
              {isAdmin() ? <span style={{ marginLeft: 10 }}>(admin)</span> : <span style={{ marginLeft: 10 }}>(viewer)</span>}
            </div>
          </div>

          <hr style={{ margin: "18px 0" }} />

          {apiError && <div style={{ color: "tomato", marginBottom: 12 }}>{apiError}</div>}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ padding: 12, border: "1px solid #333", borderRadius: 12 }}>
              <h3>Device</h3>
              <select
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                style={{ width: "100%", padding: 10 }}
              >
                <option value="">-- select --</option>
                {devices.map((d) => (
                  <option key={d.device_id} value={d.device_id}>
                    {d.thing_name || d.device_id}
                  </option>
                ))}
              </select>

              <div style={{ marginTop: 14, opacity: 0.85 }}>
                <div><b>device_id:</b> {deviceId || "—"}</div>
                <div><b>patient:</b> {devices.find(x => x.device_id === deviceId)?.patient_name || "<empty>"}</div>
              </div>

              <div style={{ marginTop: 14 }}>
                <h4>Patient name (admin)</h4>
                <input
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  disabled={!isAdmin()}
                  placeholder="Ej: Juan Pérez"
                  style={{ width: "100%", padding: 10 }}
                />
                <button
                  onClick={savePatientName}
                  disabled={!isAdmin() || !deviceId}
                  style={{ marginTop: 10, padding: "10px 14px" }}
                >
                  Guardar
                </button>
                {!isAdmin() && (
                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
                    Solo admin puede editar.
                  </div>
                )}
              </div>
            </div>

            <div style={{ padding: 12, border: "1px solid #333", borderRadius: 12 }}>
              <h3>Últimas mediciones</h3>
              {loading && <div>Cargando...</div>}
              {!loading && deviceId && measurements.length === 0 && (
                <div style={{ opacity: 0.7 }}>No hay datos (o el endpoint no devuelve items).</div>
              )}

              {!loading && measurements.length > 0 && (
                <>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
                    <Stat label="HR" value={last(measurements)?.hr} />
                    <Stat label="EDA" value={last(measurements)?.eda} />
                    <Stat label="ts" value={last(measurements)?.ts} />
                  </div>

                  {/* Mini “chart” simple textual (rápido) */}
                  <MiniSeries title="HR (últimos 30)" values={measurements.slice(-30).map(x => x.hr)} />
                  <MiniSeries title="EDA (últimos 30)" values={measurements.slice(-30).map(x => x.eda)} />
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function last(arr) {
  return arr && arr.length ? arr[arr.length - 1] : null;
}

function Stat({ label, value }) {
  return (
    <div style={{ padding: 10, border: "1px solid #444", borderRadius: 10, minWidth: 120 }}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: 20 }}>{value ?? "—"}</div>
    </div>
  );
}

function MiniSeries({ title, values }) {
  const safe = (values || []).filter(v => typeof v === "number" && !Number.isNaN(v));
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>{title}</div>
      <div style={{ fontFamily: "monospace", fontSize: 12, whiteSpace: "pre-wrap" }}>
        {safe.map(v => v.toFixed(2)).join("  ")}
      </div>
    </div>
  );
}
