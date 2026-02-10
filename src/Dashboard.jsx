import React, { useEffect, useMemo, useState } from "react";
import { fetchAuthSession } from "aws-amplify/auth";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { config } from "./amplifyConfig.js";

const API = config.apiBaseUrl; // sin slash final

const CHUNK_MS = 500;        // ESP manda un chunk cada 500ms
const WINDOW_MS = 60_000;    // últimos 60s
const POLL_MS = 1000;        // refresco dashboard

function decodeJwtPayload(token) {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "===".slice((payload.length + 3) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return {};
  }
}

async function apiGet(path, token) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiPut(path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function Dashboard({ user, signOut }) {
  const [token, setToken] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [patientIdInput, setPatientIdInput] = useState("");

  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("");

  // ====== STYLES ======
  const pageStyle = {
    minHeight: "100vh",
    padding: "28px 18px 40px",
    background:
      "radial-gradient(1200px 800px at 70% 20%, rgba(255,255,255,0.25), rgba(255,255,255,0) 60%), linear-gradient(135deg, #1f6fe5, #67b3ff)",
  };

  const shellStyle = {
    width: "75%",
    maxWidth: 1200,
    margin: "0 auto",
  };

  const topbarStyle = {
    ...shellStyle,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "16px 18px",
    borderRadius: 16,
    background: "rgba(255,255,255,0.20)",
    backdropFilter: "blur(8px)",
    border: "1px solid rgba(255,255,255,0.35)",
    color: "#0b0b0b",
  };

  const titleStyle = {
    margin: 0,
    fontSize: 36,
    lineHeight: 1.05,
    fontWeight: 800,
    letterSpacing: -0.5,
    color: "#0b0b0b",
  };

  const subStyle = {
    margin: "6px 0 0 0",
    opacity: 0.9,
    color: "#0b0b0b",
  };

  const cardStyle = {
    padding: 16,
    borderRadius: 16,
    background: "rgba(255,255,255,0.88)",
    border: "1px solid rgba(0,0,0,0.08)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
    color: "#0b0b0b",
  };

  const kpiRowStyle = {
    ...shellStyle,
    display: "flex",
    gap: 16,
    marginTop: 18,
    flexWrap: "wrap",
  };

  const kpiColStyle = {
    flex: "1 1 calc(33.333% - 12px)", // ~33%
    minWidth: 260,
  };

  const chartsRowStyle = {
    ...shellStyle,
    display: "flex",
    gap: 16,
    marginTop: 16,
    flexWrap: "wrap",
    justifyContent: "space-between",
  };

  const chartColStyle = {
    flex: "1 1 40%", // tu requerimiento
    minWidth: 360,
    maxWidth: "calc(50% - 8px)", // se ve más “pro” con 2-up y gap
  };

  const chartBoxStyle = {
    height: 280,
    borderRadius: 14,
    background: "rgba(255,255,255,0.65)",
    border: "1px solid rgba(0,0,0,0.08)",
    padding: 10,
  };

  const labelStyle = { margin: 0, fontSize: 14, opacity: 0.8 };

  const sectionTitleStyle = {
    margin: "0 0 10px 0",
    fontSize: 18,
    fontWeight: 700,
    color: "#0b0b0b",
  };

  const hintStyle = { marginTop: 8, fontSize: 13, opacity: 0.75 };

  const signOutBtnStyle = {
    background: "rgba(255,255,255,0.9)",
    border: "1px solid rgba(0,0,0,0.15)",
    color: "#0b0b0b",
    padding: "10px 14px",
    borderRadius: 12,
    fontWeight: 700,
    cursor: "pointer",
  };

  const saveBtnStyle = {
    width: "100%",
    background: "#ffffff",
    border: "1px solid rgba(0,0,0,0.15)",
    color: "#0b0b0b",
    padding: "12px 14px",
    borderRadius: 12,
    fontWeight: 800,
    cursor: "pointer",
    opacity: isAdmin ? 1 : 0.6,
  };

  const inputStyle = {
    width: "100%",
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.15)",
    outline: "none",
    background: "rgba(255,255,255,0.95)",
    color: "#0b0b0b",
    fontSize: 14,
  };

  const selectStyle = {
    ...inputStyle,
    cursor: "pointer",
  };

  const statusStyle = {
    ...shellStyle,
    marginTop: 16,
    padding: "12px 14px",
    borderRadius: 14,
    background: "rgba(255,255,255,0.90)",
    border: "1px solid rgba(0,0,0,0.10)",
    color: "#0b0b0b",
    boxShadow: "0 10px 30px rgba(0,0,0,0.10)",
  };

  // 1) token + groups
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const sess = await fetchAuthSession();
        const t = sess.tokens?.accessToken?.toString?.() || "";
        if (!mounted) return;

        setToken(t);

        const payload = decodeJwtPayload(t);
        const groups = payload["cognito:groups"];
        const admin =
          Array.isArray(groups)
            ? groups.includes("admin")
            : typeof groups === "string"
            ? groups.split(",").map((s) => s.trim()).includes("admin")
            : false;

        setIsAdmin(admin);
      } catch (e) {
        setStatus(`Auth error: ${String(e)}`);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // 2) load devices
  useEffect(() => {
    if (!token) return;
    let mounted = true;

    (async () => {
      try {
        const data = await apiGet("/devices", token);
        if (!mounted) return;

        const list = data.items || [];
        setDevices(list);

        const first = list?.[0]?.device_id || "";
        setSelectedDevice(first);
        setPatientIdInput(list?.[0]?.patient_id || "");
      } catch (e) {
        setStatus(`Error loading devices: ${String(e)}`);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [token]);

  // 3) polling measurements
  useEffect(() => {
    if (!token || !selectedDevice) return;

    let timer = null;
    let stopped = false;

    const tick = async () => {
      try {
        const now = Date.now();
        const from = now - WINDOW_MS;

        const q = `/measurements?device_id=${encodeURIComponent(
          selectedDevice
        )}&from=${from}&to=${now}&limit=800`;

        const data = await apiGet(q, token);
        if (stopped) return;

        setItems(data.items || []);
        setStatus("");
      } catch (e) {
        setStatus(`Error loading measurements: ${String(e)}`);
      }
    };

    tick();
    timer = setInterval(tick, POLL_MS);

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
    };
  }, [token, selectedDevice]);

  const selectedDeviceObj = useMemo(() => {
    return devices.find((d) => d.device_id === selectedDevice) || null;
  }, [devices, selectedDevice]);

  const latestHr = useMemo(() => {
    if (!items?.length) return 0;
    return Number(items[items.length - 1]?.hr || 0);
  }, [items]);

  const edaSeries = useMemo(() => {
    return (items || []).map((it) => ({
      t: it.ts,
      eda: Number(it.eda || 0),
    }));
  }, [items]);

  const ecgSeries = useMemo(() => {
    const pts = [];
    for (const it of items || []) {
      const arr = Array.isArray(it.ecg) ? it.ecg : [];
      const n = arr.length;
      if (n === 0) continue;

      const endTs = Number(it.ts);
      const startTs = endTs - CHUNK_MS;
      const dt = CHUNK_MS / n;

      for (let i = 0; i < n; i++) {
        pts.push({
          t: Math.round(startTs + i * dt),
          ecg: Number(arr[i] || 0),
        });
      }
    }

    const cutoff = Date.now() - WINDOW_MS;
    return pts.filter((p) => p.t >= cutoff);
  }, [items]);

  const onChangeDevice = (e) => {
    const dev = e.target.value;
    setSelectedDevice(dev);

    const obj = devices.find((d) => d.device_id === dev);
    setPatientIdInput(obj?.patient_id || "");
    setItems([]);
    setStatus("");
  };

  const onSavePatientId = async () => {
    if (!isAdmin) return;
    if (!selectedDevice) return;

    const pid = (patientIdInput || "").trim();
    if (!pid) {
      setStatus("patient_id requerido");
      return;
    }

    try {
      await apiPut(`/devices/${encodeURIComponent(selectedDevice)}`, token, {
        patient_id: pid,
      });

      const data = await apiGet("/devices", token);
      setDevices(data.items || []);
      setStatus("✅ patient_id actualizado");
    } catch (e) {
      setStatus(`Error updating patient_id: ${String(e)}`);
    }
  };

  const email = user?.signInDetails?.loginId || user?.username || "user";

  return (
    <div style={pageStyle}>
      {/* TOPBAR 75% centrado */}
      <div style={topbarStyle}>
        <div>
          <h2 style={titleStyle}>Bio Dashboard</h2>
          <p style={subStyle}>
            {email} {isAdmin ? "(admin)" : "(viewer)"}
          </p>
        </div>
        <button style={signOutBtnStyle} onClick={signOut}>
          Sign out
        </button>
      </div>

      {/* KPIs 3 columnas ~33% */}
      <div style={kpiRowStyle}>
        <div style={kpiColStyle}>
          <div style={cardStyle}>
            <h3 style={sectionTitleStyle}>Device</h3>
            <p style={labelStyle}>Select device</p>
            <div style={{ height: 8 }} />
            <select style={selectStyle} value={selectedDevice} onChange={onChangeDevice}>
              {devices.map((d) => (
                <option key={d.device_id} value={d.device_id}>
                  {d.device_id}
                </option>
              ))}
            </select>
            <div style={hintStyle}>
              patient_id actual: <b>{selectedDeviceObj?.patient_id || "-"}</b>
            </div>
          </div>
        </div>

        <div style={kpiColStyle}>
          <div style={cardStyle}>
            <h3 style={sectionTitleStyle}>HR</h3>
            <div style={{ fontSize: 44, fontWeight: 900, marginTop: 2 }}>
              {latestHr.toFixed(0)} <span style={{ fontSize: 18, fontWeight: 800 }}>bpm</span>
            </div>
            <div style={hintStyle}>Actualiza cada {POLL_MS} ms</div>
          </div>
        </div>

        <div style={kpiColStyle}>
          <div style={cardStyle}>
            <h3 style={sectionTitleStyle}>Admin</h3>
            <p style={labelStyle}>Set patient_id</p>
            <div style={{ height: 8 }} />
            <input
              style={inputStyle}
              placeholder="patient_id (ej: PACIENTE_001)"
              value={patientIdInput}
              onChange={(e) => setPatientIdInput(e.target.value)}
              disabled={!isAdmin}
            />
            <div style={{ height: 10 }} />
            <button style={saveBtnStyle} disabled={!isAdmin} onClick={onSavePatientId}>
              Save patient_id
            </button>
            {!isAdmin && <div style={hintStyle}>Solo admin puede editar</div>}
          </div>
        </div>
      </div>

      {/* STATUS */}
      {status ? (
        <div style={statusStyle}>
          <b>Status:</b> {status}
        </div>
      ) : null}

      {/* Charts: 2 columnas ~40% */}
      <div style={chartsRowStyle}>
        <div style={chartColStyle}>
          <div style={cardStyle}>
            <h3 style={sectionTitleStyle}>EDA (últimos 60s)</h3>
            <div style={chartBoxStyle}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={edaSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="t"
                    tickFormatter={(v) => new Date(v).toLocaleTimeString()}
                    minTickGap={30}
                  />
                  <YAxis />
                  <Tooltip labelFormatter={(v) => new Date(v).toLocaleTimeString()} />
                  <Line type="monotone" dataKey="eda" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={hintStyle}>
              EDA llega a 1Hz (o la frecuencia que publiques).
            </div>
          </div>
        </div>

        <div style={chartColStyle}>
          <div style={cardStyle}>
            <h3 style={sectionTitleStyle}>ECG (reconstruido desde chunks)</h3>
            <div style={chartBoxStyle}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={ecgSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="t"
                    tickFormatter={(v) => new Date(v).toLocaleTimeString()}
                    minTickGap={30}
                  />
                  <YAxis />
                  <Tooltip labelFormatter={(v) => new Date(v).toLocaleTimeString()} />
                  <Line type="linear" dataKey="ecg" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={hintStyle}>
              ECG asume chunk = {CHUNK_MS}ms. Si envías 125 muestras ⇒ 250Hz.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
