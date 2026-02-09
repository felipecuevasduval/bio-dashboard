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
import { apiGet, apiPut } from "./api.js";

const CHUNK_MS = 500;   // ESP mandará bloques cada 500ms
const WINDOW_MS = 60_000; // últimos 60s
const POLL_MS = 1000;     // refresco dashboard

function decodeJwtPayload(token) {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "===".slice((payload.length + 3) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return {};
  }
}

export default function Dashboard({ user, signOut }) {
  const [token, setToken] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState("");

  const [patientIdInput, setPatientIdInput] = useState("");
  const [status, setStatus] = useState("");
  const [items, setItems] = useState([]);

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
          Array.isArray(groups) ? groups.includes("admin") :
          typeof groups === "string" ? groups.split(",").map(s => s.trim()).includes("admin") :
          false;
        setIsAdmin(admin);
      } catch (e) {
        setStatus(`Auth error: ${String(e)}`);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // 2) load devices al iniciar
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

    return () => { mounted = false; };
  }, [token]);

  // device actual
  const selectedDeviceObj = useMemo(() => {
    return devices.find((d) => d.device_id === selectedDevice) || null;
  }, [devices, selectedDevice]);

  // 3) polling measurements
  useEffect(() => {
    if (!token || !selectedDevice) return;

    let timer = null;
    let stopped = false;

    const tick = async () => {
      try {
        const now = Date.now();
        const from = now - WINDOW_MS;

        const q = `/measurements?device_id=${encodeURIComponent(selectedDevice)}&from=${from}&to=${now}&limit=800`;
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

  // 4) EDA series (simple)
  const edaSeries = useMemo(() => {
    return (items || []).map((it) => ({
      t: it.ts,
      eda: Number(it.eda || 0),
    }));
  }, [items]);

  // 5) HR display
  const latestHr = useMemo(() => {
    if (!items?.length) return 0;
    return Number(items[items.length - 1]?.hr || 0);
  }, [items]);

  // 6) ECG flatten: cada item trae ecg[] de N muestras
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

    // recorta a ventana
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
      await apiPut(`/devices/${encodeURIComponent(selectedDevice)}`, token, { patient_id: pid });
      // refresca lista devices (para ver el cambio)
      const data = await apiGet("/devices", token);
      setDevices(data.items || []);
      setStatus("✅ patient_id actualizado");
    } catch (e) {
      setStatus(`Error updating patient_id: ${String(e)}`);
    }
  };

  const email = user?.signInDetails?.loginId || user?.username || "user";

  return (
    <div className="page">
      <div className="topbar">
        <div>
          <div className="title">Bio Dashboard</div>
          <div className="sub">
            {email} {isAdmin ? "(admin)" : "(viewer)"}
          </div>
        </div>
        <button className="btn" onClick={signOut}>Sign out</button>
      </div>

      <div className="sep" />

      <div className="controlBar">
        <div className="field">
          <div className="label">Device</div>
          <select value={selectedDevice} onChange={onChangeDevice}>
            {devices.map((d) => (
              <option key={d.device_id} value={d.device_id}>
                {d.device_id}
              </option>
            ))}
          </select>
          <div className="tiny">
            patient_id: <b>{selectedDeviceObj?.patient_id || "-"}</b>
          </div>
        </div>

        <div className="field">
          <div className="label">HR</div>
          <div className="kpi">{latestHr.toFixed(0)} bpm</div>
          <div className="tiny">Actualiza cada {POLL_MS}ms</div>
        </div>

        <div className="field">
          <div className="label">Admin</div>
          <input
            placeholder="patient_id (ej: PACIENTE_001)"
            value={patientIdInput}
            onChange={(e) => setPatientIdInput(e.target.value)}
            disabled={!isAdmin}
          />
          <button className="btnPrimary" disabled={!isAdmin} onClick={onSavePatientId}>
            Save patient_id
          </button>
          {!isAdmin && <div className="tiny">Solo admin puede editar</div>}
        </div>
      </div>

      {status ? <div className="status">{status}</div> : null}

      <div className="grid">
        <div className="card">
          <div className="cardTitle">EDA (últimos 60s)</div>
          <div className="chart">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={edaSeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="t"
                  tickFormatter={(v) => new Date(v).toLocaleTimeString()}
                  minTickGap={30}
                />
                <YAxis />
                <Tooltip
                  labelFormatter={(v) => new Date(v).toLocaleTimeString()}
                />
                <Line type="monotone" dataKey="eda" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="hint">EDA llega a 1Hz o como tú la publiques. El dashboard no asume frecuencia fija.</div>
        </div>

        <div className="card">
          <div className="cardTitle">ECG (reconstruido desde chunks)</div>
          <div className="chart">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={ecgSeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="t"
                  tickFormatter={(v) => new Date(v).toLocaleTimeString()}
                  minTickGap={30}
                />
                <YAxis />
                <Tooltip
                  labelFormatter={(v) => new Date(v).toLocaleTimeString()}
                />
                <Line type="linear" dataKey="ecg" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="hint">
            ECG asume chunk = {CHUNK_MS}ms. Si envías 125 muestras ⇒ 250Hz. Si envías 500, también funciona (dt=chunk/N).
          </div>
        </div>
      </div>
    </div>
  );
}
