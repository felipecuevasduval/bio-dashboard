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

const CHUNK_MS = 500;         // ESP manda un chunk cada 500ms
const WINDOW_MS = 60_000;     // últimos 60s guardados en memoria
const DISPLAY_MS_EDA = 60_000; // EDA visible: 60s
const DISPLAY_MS_ECG = 5_000;  // ECG visible: 5s
const POLL_MS = 1000;         // refresco dashboard (1s)
const CLOCK_MS = 250;         // refresco reloj UI

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

function computeYDomain(points, key) {
  if (!points || points.length < 2) return ["auto", "auto"];
  let mn = Number.POSITIVE_INFINITY;
  let mx = Number.NEGATIVE_INFINITY;

  for (const p of points) {
    const v = Number(p?.[key]);
    if (!Number.isFinite(v)) continue;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }

  if (!Number.isFinite(mn) || !Number.isFinite(mx)) return ["auto", "auto"];
  if (mn === mx) {
    const pad = Math.max(1e-6, Math.abs(mn) * 0.05);
    return [mn - pad, mx + pad];
  }

  const span = mx - mn;
  const pad = span * 0.08;
  return [mn - pad, mx + pad];
}

export default function Dashboard({ user, signOut }) {
  const [token, setToken] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [patientIdInput, setPatientIdInput] = useState("");

  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("");

  // reloj actual (hora del navegador)
  const [nowMs, setNowMs] = useState(Date.now());

  // Ventanas X independientes
  const [followLiveEda, setFollowLiveEda] = useState(true);
  const [viewToEda, setViewToEda] = useState(Date.now());

  const [followLiveEcg, setFollowLiveEcg] = useState(true);
  const [viewToEcg, setViewToEcg] = useState(Date.now());

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
    flex: "1 1 calc(33.333% - 12px)",
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
    flex: "1 1 40%",
    minWidth: 360,
    maxWidth: "calc(50% - 8px)",
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

  const timelineCardStyle = {
    ...cardStyle,
    marginTop: 10,
    paddingTop: 12,
  };

  const timelineControlsStyle = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  };

  const smallBtnStyle = {
    background: "#ffffff",
    border: "1px solid rgba(0,0,0,0.15)",
    color: "#0b0b0b",
    padding: "8px 12px",
    borderRadius: 10,
    fontWeight: 800,
    cursor: "pointer",
  };

  // 1) token + groups
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const sess = await fetchAuthSession();
        const t =
          sess.tokens?.idToken?.toString?.() ||
          sess.tokens?.accessToken?.toString?.() ||
          "";
        if (!mounted) return;

        setToken(t);

        const payload = decodeJwtPayload(t);
        const groups = payload["cognito:groups"];
        const admin =
          Array.isArray(groups)
            ? groups.includes("admin")
            : typeof groups === "string"
            ? groups
                .split(",")
                .map((s) => s.trim())
                .includes("admin")
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

  // reloj actual
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), CLOCK_MS);
    return () => clearInterval(t);
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

  const latestItem = useMemo(() => {
    if (!items?.length) return null;
    return items[items.length - 1] || null;
  }, [items]);

  const latestHr = useMemo(() => Number(latestItem?.hr || 0), [latestItem]);
  const latestSpo2 = useMemo(() => Number(latestItem?.spo2 || 0), [latestItem]);

  const latestLeadOff = useMemo(() => {
    const v = latestItem?.leadOff ?? latestItem?.lead_off ?? 0;
    return Number(v || 0);
  }, [latestItem]);

  const latestTs = useMemo(() => {
    const t = Number(latestItem?.ts || 0);
    return Number.isFinite(t) ? t : 0;
  }, [latestItem]);

  // Series completas (hasta 60s)
  const edaSeries = useMemo(() => {
    return (items || []).map((it) => ({
      t: Number(it.ts),
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

  // Bounds independientes por chart
  const boundsEda = useMemo(() => {
    if (!edaSeries.length) {
      const t = Date.now();
      return { min: t - WINDOW_MS, max: t };
    }
    return { min: edaSeries[0].t, max: edaSeries[edaSeries.length - 1].t };
  }, [edaSeries]);

  const boundsEcg = useMemo(() => {
    if (!ecgSeries.length) {
      const t = Date.now();
      return { min: t - WINDOW_MS, max: t };
    }
    return { min: ecgSeries[0].t, max: ecgSeries[ecgSeries.length - 1].t };
  }, [ecgSeries]);

  const clampViewTo = (kind, v) => {
    const isEda = kind === "eda";
    const display = isEda ? DISPLAY_MS_EDA : DISPLAY_MS_ECG;
    const b = isEda ? boundsEda : boundsEcg;

    const max = Number.isFinite(b.max) ? b.max : Date.now();
    const minAllowed = (Number.isFinite(b.min) ? b.min : Date.now() - WINDOW_MS) + display;

    if (!Number.isFinite(v)) return max;
    if (max <= minAllowed) return max; // no hay rango suficiente
    if (v < minAllowed) return minAllowed;
    if (v > max) return max;
    return v;
  };

  // Auto-follow independiente
  useEffect(() => {
    if (!followLiveEda) return;
    const anchor = latestTs || Date.now();
    setViewToEda(clampViewTo("eda", anchor));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followLiveEda, latestTs, boundsEda.min, boundsEda.max]);

  useEffect(() => {
    if (!followLiveEcg) return;
    const anchor = latestTs || Date.now();
    setViewToEcg(clampViewTo("ecg", anchor));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followLiveEcg, latestTs, boundsEcg.min, boundsEcg.max]);

  const viewFromEda = useMemo(() => viewToEda - DISPLAY_MS_EDA, [viewToEda]);
  const viewFromEcg = useMemo(() => viewToEcg - DISPLAY_MS_ECG, [viewToEcg]);

  // slider ranges (min es b.min + display)
  const sliderMinEda = useMemo(() => boundsEda.min + DISPLAY_MS_EDA, [boundsEda.min]);
  const sliderMaxEda = useMemo(() => boundsEda.max, [boundsEda.max]);
  const sliderDisabledEda = useMemo(() => sliderMaxEda <= sliderMinEda, [sliderMaxEda, sliderMinEda]);

  const sliderMinEcg = useMemo(() => boundsEcg.min + DISPLAY_MS_ECG, [boundsEcg.min]);
  const sliderMaxEcg = useMemo(() => boundsEcg.max, [boundsEcg.max]);
  const sliderDisabledEcg = useMemo(() => sliderMaxEcg <= sliderMinEcg, [sliderMaxEcg, sliderMinEcg]);

  // Evita que viewTo quede fuera al cambiar datos
  useEffect(() => {
    setViewToEda((prev) => clampViewTo("eda", prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliderMinEda, sliderMaxEda]);

  useEffect(() => {
    setViewToEcg((prev) => clampViewTo("ecg", prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliderMinEcg, sliderMaxEcg]);

  // Data visible para auto-ajuste de Y
  const edaVisible = useMemo(
    () => edaSeries.filter((p) => p.t >= viewFromEda && p.t <= viewToEda),
    [edaSeries, viewFromEda, viewToEda]
  );

  const ecgVisible = useMemo(
    () => ecgSeries.filter((p) => p.t >= viewFromEcg && p.t <= viewToEcg),
    [ecgSeries, viewFromEcg, viewToEcg]
  );

  const edaYDomain = useMemo(() => computeYDomain(edaVisible, "eda"), [edaVisible]);
  const ecgYDomain = useMemo(() => computeYDomain(ecgVisible, "ecg"), [ecgVisible]);

  const onChangeDevice = (e) => {
    const dev = e.target.value;
    setSelectedDevice(dev);

    const obj = devices.find((d) => d.device_id === dev);
    setPatientIdInput(obj?.patient_id || "");
    setItems([]);
    setStatus("");

    const t = Date.now();
    setFollowLiveEda(true);
    setFollowLiveEcg(true);
    setViewToEda(t);
    setViewToEcg(t);
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
      setStatus("patient_id actualizado");
    } catch (e) {
      setStatus(`Error updating patient_id: ${String(e)}`);
    }
  };

  const onLiveEda = () => {
    setFollowLiveEda(true);
    const anchor = latestTs || Date.now();
    setViewToEda(clampViewTo("eda", anchor));
  };

  const onLiveEcg = () => {
    setFollowLiveEcg(true);
    const anchor = latestTs || Date.now();
    setViewToEcg(clampViewTo("ecg", anchor));
  };

  const onTimelineChangeEda = (e) => {
    const v = Number(e.target.value);
    setFollowLiveEda(false);
    setViewToEda(clampViewTo("eda", v));
  };

  const onTimelineChangeEcg = (e) => {
    const v = Number(e.target.value);
    setFollowLiveEcg(false);
    setViewToEcg(clampViewTo("ecg", v));
  };

  const nowTimeStr = useMemo(() => new Date(nowMs).toLocaleTimeString(), [nowMs]);
  const nowDateTimeStr = useMemo(() => new Date(nowMs).toLocaleString(), [nowMs]);

  const email = user?.signInDetails?.loginId || user?.username || "user";

  return (
    <div style={pageStyle}>
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
            <div style={hintStyle}>Actualiza cada 1s</div>
          </div>
        </div>

        <div style={kpiColStyle}>
          <div style={cardStyle}>
            <h3 style={sectionTitleStyle}>SpO2</h3>
            <div style={{ fontSize: 44, fontWeight: 900, marginTop: 2 }}>
              {latestSpo2.toFixed(0)} <span style={{ fontSize: 18, fontWeight: 800 }}>%</span>
            </div>
            <div style={hintStyle}>Último valor recibido</div>
          </div>
        </div>

        <div style={kpiColStyle}>
          <div style={cardStyle}>
            <h3 style={sectionTitleStyle}>Hora</h3>
            <div style={{ fontSize: 34, fontWeight: 900, marginTop: 6 }}>
              {nowTimeStr}
            </div>
            <div style={hintStyle}>{nowDateTimeStr}</div>
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

      {status ? (
        <div style={statusStyle}>
          <b>Status:</b> {status}
        </div>
      ) : null}

      <div style={chartsRowStyle}>
        {/* ====== EDA ====== */}
        <div style={chartColStyle}>
          <div style={cardStyle}>
            <h3 style={sectionTitleStyle}>EDA</h3>

            <div style={chartBoxStyle}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={edaSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="t"
                    type="number"
                    domain={[viewFromEda, viewToEda]}
                    allowDataOverflow
                    tickFormatter={(v) => new Date(v).toLocaleTimeString()}
                    minTickGap={30}
                  />
                  <YAxis domain={edaYDomain} />
                  <Tooltip labelFormatter={(v) => new Date(v).toLocaleTimeString()} />
                  <Line type="monotone" dataKey="eda" dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div style={timelineCardStyle}>
              <div style={timelineControlsStyle}>
                <button style={smallBtnStyle} onClick={onLiveEda} disabled={!items.length}>
                  Live
                </button>

                <div style={{ flex: "1 1 520px", minWidth: 260 }}>
                  <input
                    type="range"
                    min={Number.isFinite(sliderMinEda) ? sliderMinEda : Date.now() - WINDOW_MS + DISPLAY_MS_EDA}
                    max={Number.isFinite(sliderMaxEda) ? sliderMaxEda : Date.now()}
                    value={clampViewTo("eda", viewToEda)}
                    onChange={onTimelineChangeEda}
                    disabled={sliderDisabledEda || !items.length}
                    style={{ width: "100%" }}
                  />
                  <div style={hintStyle}>
                    Ventana: {DISPLAY_MS_EDA / 1000}s | Modo: <b>{followLiveEda ? "live" : "manual"}</b> | Vista hasta:{" "}
                    <b>{new Date(clampViewTo("eda", viewToEda)).toLocaleTimeString()}</b>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* ====== ECG ====== */}
        <div style={chartColStyle}>
          <div style={cardStyle}>
            <h3 style={sectionTitleStyle}>ECG</h3>

            <div style={chartBoxStyle}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={ecgSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="t"
                    type="number"
                    domain={[viewFromEcg, viewToEcg]}
                    allowDataOverflow
                    tickFormatter={(v) => new Date(v).toLocaleTimeString()}
                    minTickGap={30}
                  />
                  <YAxis domain={ecgYDomain} />
                  <Tooltip labelFormatter={(v) => new Date(v).toLocaleTimeString()} />
                  <Line type="linear" dataKey="ecg" dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div style={timelineCardStyle}>
              <div style={timelineControlsStyle}>
                <button style={smallBtnStyle} onClick={onLiveEcg} disabled={!items.length}>
                  Live
                </button>

                <div style={{ flex: "1 1 520px", minWidth: 260 }}>
                  <input
                    type="range"
                    min={Number.isFinite(sliderMinEcg) ? sliderMinEcg : Date.now() - WINDOW_MS + DISPLAY_MS_ECG}
                    max={Number.isFinite(sliderMaxEcg) ? sliderMaxEcg : Date.now()}
                    value={clampViewTo("ecg", viewToEcg)}
                    onChange={onTimelineChangeEcg}
                    disabled={sliderDisabledEcg || !items.length}
                    style={{ width: "100%" }}
                  />
                  <div style={hintStyle}>
                    Ventana: {DISPLAY_MS_ECG / 1000}s | Modo: <b>{followLiveEcg ? "live" : "manual"}</b> | Vista hasta:{" "}
                    <b>{new Date(clampViewTo("ecg", viewToEcg)).toLocaleTimeString()}</b>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

      <div style={{ ...shellStyle, marginTop: 16 }}>
        <div style={cardStyle}>
          <h3 style={sectionTitleStyle}>ECG Lead Off</h3>
          <div style={{ fontSize: 18, fontWeight: 800 }}>
            {latestLeadOff ? "Detectado (electrodos desconectados)" : "No detectado (OK)"}
          </div>
          <div style={hintStyle}>leadOff = {String(latestLeadOff)} (0 = OK, 1 = lead off)</div>
        </div>
      </div>
    </div>
  );
}