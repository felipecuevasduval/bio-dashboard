// src/Dashboard.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { fetchAuthSession } from "aws-amplify/auth";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { config } from "./amplifyConfig.js";

function parseJwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    return JSON.parse(atob(padded));
  } catch {
    return {};
  }
}

async function getAccessToken() {
  const session = await fetchAuthSession();
  const token = session?.tokens?.accessToken?.toString();
  if (!token) throw new Error("No access token");
  return token;
}

async function apiGet(path) {
  const token = await getAccessToken();
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || data?.message || "Request failed");
  return data;
}

async function apiPut(path, body) {
  const token = await getAccessToken();
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || data?.message || "Request failed");
  return data;
}

function formatTs(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString();
}

export default function Dashboard({ user, signOut }) {
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [patientId, setPatientId] = useState("");
  const [saving, setSaving] = useState(false);

  const [hrSeries, setHrSeries] = useState([]);
  const [edaSeries, setEdaSeries] = useState([]);
  const [kpis, setKpis] = useState({ hr: null, eda: null, lastTs: null });

  const [status, setStatus] = useState({ loading: true, err: "" });
  const timerRef = useRef(null);

  const [isAdmin, setIsAdmin] = useState(false);

  // Detect admin from token claims (cognito:groups)
  useEffect(() => {
    (async () => {
      try {
        const token = await getAccessToken();
        const claims = parseJwtPayload(token);
        const groups = claims["cognito:groups"];
        const arr = Array.isArray(groups)
          ? groups
          : typeof groups === "string"
          ? groups.split(",").map((s) => s.trim())
          : [];
        setIsAdmin(arr.includes("admin"));
      } catch {
        setIsAdmin(false);
      }
    })();
  }, []);

  // Load devices
  useEffect(() => {
    (async () => {
      try {
        setStatus({ loading: true, err: "" });
        const data = await apiGet("/devices");
        const list = data?.items || [];
        setDevices(list);
        const first = list?.[0]?.device_id || "";
        setSelectedDeviceId(first);
        setPatientId(list?.[0]?.patient_id || "");
        setStatus({ loading: false, err: "" });
      } catch (e) {
        setStatus({ loading: false, err: String(e.message || e) });
      }
    })();
  }, []);

  // When selecting device, update patientId field and start polling
  useEffect(() => {
    const dev = devices.find((d) => d.device_id === selectedDeviceId);
    setPatientId(dev?.patient_id || "");

    if (!selectedDeviceId) return;

    const poll = async () => {
      try {
        const now = Date.now();
        const from = now - 60_000; // last 60s
        const limit = 500; // con 200ms -> ~300 puntos/min
        const data = await apiGet(
          `/measurements?device_id=${encodeURIComponent(selectedDeviceId)}&from=${from}&to=${now}&limit=${limit}`
        );

        const items = Array.isArray(data?.items) ? data.items : [];
        // Normaliza
        const series = items
          .map((x) => ({
            ts: Number(x.ts),
            hr: Number(x.hr ?? 0),
            eda: Number(x.eda ?? 0),
          }))
          .filter((x) => Number.isFinite(x.ts))
          .sort((a, b) => a.ts - b.ts);

        const hr = series.map((p) => ({ t: p.ts, v: p.hr }));
        const eda = series.map((p) => ({ t: p.ts, v: p.eda }));

        setHrSeries(
          hr.map((p) => ({ time: formatTs(p.t), value: p.v }))
        );
        setEdaSeries(
          eda.map((p) => ({ time: formatTs(p.t), value: p.v }))
        );

        const last = series[series.length - 1];
        setKpis({
          hr: last ? last.hr : null,
          eda: last ? last.eda : null,
          lastTs: last ? last.ts : null,
        });
        setStatus((s) => ({ ...s, err: "" }));
      } catch (e) {
        setStatus((s) => ({ ...s, err: String(e.message || e) }));
      }
    };

    poll();
    timerRef.current && clearInterval(timerRef.current);
    timerRef.current = setInterval(poll, 2000);

    return () => {
      timerRef.current && clearInterval(timerRef.current);
    };
  }, [selectedDeviceId, devices]);

  const selectedDevice = useMemo(
    () => devices.find((d) => d.device_id === selectedDeviceId),
    [devices, selectedDeviceId]
  );

  const onSavePatientId = async () => {
    if (!selectedDeviceId) return;
    if (!patientId.trim()) return;

    try {
      setSaving(true);
      await apiPut(`/devices/${encodeURIComponent(selectedDeviceId)}`, {
        patient_id: patientId.trim(),
      });

      // update local list
      setDevices((prev) =>
        prev.map((d) =>
          d.device_id === selectedDeviceId ? { ...d, patient_id: patientId.trim() } : d
        )
      );
    } catch (e) {
      setStatus((s) => ({ ...s, err: String(e.message || e) }));
    } finally {
      setSaving(false);
    }
  };

  if (status.loading) {
    return (
      <div className="page">
        <div className="container">
          <div className="card">Cargando...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container">
        <header className="topbar">
          <div>
            <h1>Bio Dashboard</h1>
            <div className="muted">
              API: {config.apiBaseUrl}
              {kpis.lastTs ? ` · last: ${new Date(kpis.lastTs).toLocaleString()}` : ""}
            </div>
          </div>

          <div className="topbarRight">
            <div className="pill">
              {user?.username ? `@${user.username}` : "signed"}
              {isAdmin ? " · admin" : " · viewer"}
            </div>
            <button className="btn" onClick={signOut}>
              Sign out
            </button>
          </div>
        </header>

        {status.err ? <div className="alert">⚠️ {status.err}</div> : null}

        <div className="grid">
          {/* Left: Devices */}
          <section className="card">
            <h2>Devices</h2>

            <label className="label">Select device</label>
            <select
              className="select"
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
            >
              {devices.map((d) => (
                <option key={d.device_id} value={d.device_id}>
                  {d.device_id}
                </option>
              ))}
            </select>

            <div className="kv">
              <div className="k">thing_name</div>
              <div className="v">{selectedDevice?.thing_name || "-"}</div>

              <div className="k">patient_id</div>
              <div className="v">{selectedDevice?.patient_id || "-"}</div>
            </div>

            <hr className="sep" />

            <h3>Admin: set patient_id</h3>
            <div className="muted small">
              Solo admin puede guardar (PUT /devices/:id)
            </div>

            <input
              className="input"
              placeholder="e.g. PACIENTE_001"
              value={patientId}
              disabled={!isAdmin}
              onChange={(e) => setPatientId(e.target.value)}
            />

            <button
              className="btnPrimary"
              disabled={!isAdmin || saving || !patientId.trim()}
              onClick={onSavePatientId}
            >
              {saving ? "Saving..." : "Save patient_id"}
            </button>
          </section>

          {/* Right: Charts */}
          <section className="card">
            <div className="cardHeader">
              <div>
                <h2>Live data</h2>
                <div className="muted small">Last 60s · polling 2s</div>
              </div>

              <div className="kpis">
                <div className="kpi">
                  <div className="kpiLabel">HR (bpm)</div>
                  <div className="kpiValue">{kpis.hr ?? "—"}</div>
                </div>
                <div className="kpi">
                  <div className="kpiLabel">EDA</div>
                  <div className="kpiValue">{kpis.eda ?? "—"}</div>
                </div>
              </div>
            </div>

            <div className="chartBlock">
              <div className="chartTitle">HR</div>
              <div className="chart">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={hrSeries}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" tickMargin={8} />
                    <YAxis tickMargin={8} />
                    <Tooltip />
                    <Line type="monotone" dataKey="value" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="chartBlock">
              <div className="chartTitle">EDA</div>
              <div className="chart">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={edaSeries}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" tickMargin={8} />
                    <YAxis tickMargin={8} />
                    <Tooltip />
                    <Line type="monotone" dataKey="value" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>
        </div>

        <footer className="footer muted small">
          Tip: si no ves data, confirma que tu IoT Rule está metiendo ts en ms y que el endpoint /measurements devuelve items.
        </footer>
      </div>
    </div>
  );
}
