import { M365BleClient } from "./ble.js";

const $ = (id) => document.getElementById(id);

const state = {
  speedKmh: 0,
  displaySpeed: 0,
  batt: null,
  watts: null,
  amps: null,
  volts: null,
  avgKmh: null,
  rangeKm: null,
  tripSec: null,
  tripM: null,
  odoM: null,
  tempEsc: null,
  maxGauge: 100,
};

const client = new M365BleClient();
let raf = 0;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function drawGauge() {
  const canvas = $("gauge");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h * 0.92;
  const r = Math.min(w, h) * 0.72;

  ctx.clearRect(0, 0, w, h);

  const maxS = state.maxGauge;
  const t = Math.min(1, Math.max(0, state.displaySpeed / maxS));
  const start = Math.PI * 0.82;
  const sweep = Math.PI * 0.76;
  const ang = start + t * sweep;

  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, "#1a3d2e");
  grad.addColorStop(0.5, "#3dff9c");
  grad.addColorStop(1, "#4db8ff");

  ctx.lineWidth = 14;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#151c2a";
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, start + sweep);
  ctx.stroke();

  ctx.strokeStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, ang);
  ctx.stroke();

  const dotR = 9;
  const px = cx + Math.cos(ang) * r;
  const py = cy + Math.sin(ang) * r;
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(61,255,156,0.9)";
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.arc(px, py, dotR, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = "rgba(122,134,159,0.5)";
  ctx.font = "600 11px Segoe UI, sans-serif";
  for (let i = 0; i <= 10; i++) {
    const u = i / 10;
    const a = start + u * sweep;
    const tx = cx + Math.cos(a) * (r - 24);
    const ty = cy + Math.sin(a) * (r - 24);
    const val = Math.round((maxS / 10) * i);
    ctx.fillText(String(val), tx - 6, ty + 4);
  }
}

function tickAnim() {
  const target = state.speedKmh;
  state.displaySpeed = lerp(state.displaySpeed, target, 0.18);
  if (Math.abs(state.displaySpeed - target) < 0.05) state.displaySpeed = target;
  $("speedDisplay").textContent = state.displaySpeed.toFixed(1);
  drawGauge();
  raf = requestAnimationFrame(tickAnim);
}

function applyTelemetry(ev) {
  if (ev.type === "b0") {
    state.speedKmh = ev.speedKmh ?? 0;
    if (ev.batteryPct != null) state.batt = ev.batteryPct;
    if (ev.avgKmh != null) state.avgKmh = ev.avgKmh;
    if (ev.odometerM != null) state.odoM = ev.odometerM;
    if (ev.tempX10 != null) state.tempEsc = ev.tempX10 / 10;
    $("avgSpeed").textContent =
      state.avgKmh != null ? `${state.avgKmh.toFixed(1)} km/h` : "—";
    $("odo").textContent =
      state.odoM != null ? `${(state.odoM / 1000).toFixed(2)} km` : "—";
    $("tempEsc").textContent =
      state.tempEsc != null ? `${state.tempEsc.toFixed(1)} °C` : "—";
  }
  if (ev.type === "bms") {
    if (ev.percent != null) state.batt = ev.percent;
    if (ev.voltageV != null) state.volts = ev.voltageV;
    if (ev.currentA != null) state.amps = ev.currentA;
    if (ev.watts != null) state.watts = ev.watts;
    else if (state.volts != null && state.amps != null) {
      state.watts = Math.abs(state.volts * state.amps);
    }
  }
  if (ev.type === "trip") {
    state.tripSec = ev.tripSec;
    state.tripM = ev.tripM;
    const mm = Math.floor((ev.tripSec ?? 0) / 60);
    const ss = (ev.tripSec ?? 0) % 60;
    $("tripStr").textContent = `${mm}m ${ss}s · ${ev.tripM ?? 0} m`;
  }
  if (ev.type === "range") {
    state.rangeKm = ev.rangeKm;
    $("rangeKm").textContent =
      state.rangeKm != null ? `${state.rangeKm.toFixed(1)} km` : "—";
  }
  if (ev.type === "connected") {
    $("status").textContent = `Verbunden · ${ev.name || ev.id}`;
    $("btnConnect").disabled = true;
    $("btnDisconnect").disabled = false;
  }
  if (ev.type === "disconnected") {
    $("status").textContent = "Getrennt";
    $("btnConnect").disabled = false;
    $("btnDisconnect").disabled = true;
  }

  $("batt").textContent = state.batt != null ? String(Math.round(state.batt)) : "—";
  $("volts").textContent = state.volts != null ? state.volts.toFixed(1) : "—";
  $("amps").textContent = state.amps != null ? state.amps.toFixed(2) : "—";
  $("watts").textContent =
    state.watts != null ? Math.round(state.watts).toString() : "—";
}

function setupBasicMode() {
  const el = $("basicMode");
  const apply = () => {
    document.body.classList.toggle("basic-on", el.checked);
    localStorage.setItem("xd_basic", el.checked ? "1" : "0");
  };
  el.checked = localStorage.getItem("xd_basic") !== "0";
  apply();
  el.addEventListener("change", apply);
}

function setupEcoSport() {
  const wrap = $("ecoSport");
  let mode = "eco";
  wrap.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", async () => {
      mode = b.dataset.m;
      wrap.querySelectorAll("button").forEach((x) =>
        x.classList.toggle("active", x === b)
      );
      try {
        await client.applyEcoSportProfile(mode);
      } catch (_) {}
    });
  });
}

function setupSliders() {
  const top = $("topSpeed");
  const start = $("startSpeed");
  const topV = $("topSpeedVal");
  const stV = $("startSpeedVal");
  top.addEventListener("input", () => {
    topV.textContent = top.value;
    state.maxGauge = Math.max(40, Number(top.value));
  });
  start.addEventListener("input", () => {
    stV.textContent = start.value;
  });
  $("btnApplySpeed").addEventListener("click", async () => {
    const kmh = Number($("topSpeed").value);
    /** Heuristic mapping: stock doc used 0x4e20 / 0x10000 — values are firmware-specific */
    const w1 = Math.min(0xffff, Math.round(kmh * 200));
    const w2 = Math.min(0xffff, Math.round(Number($("startSpeed").value) * 200));
    try {
      await client.writeSpeedLimitU32(w1, w2);
      $("status").textContent = `Speed-Limit gesendet (${kmh} km/h)`;
    } catch (e) {
      $("status").textContent = String(e.message || e);
    }
  });
}

async function connect() {
  try {
    $("status").textContent = "Suche / koppelt…";
    await client.connect();
  } catch (e) {
    $("status").textContent = String(e.message || e);
  }
}

function init() {
  setupBasicMode();
  setupEcoSport();
  setupSliders();
  state.maxGauge = Math.max(40, Number($("topSpeed").value));
  client.onTelemetry(applyTelemetry);
  $("btnConnect").addEventListener("click", connect);
  $("btnDisconnect").addEventListener("click", () => client.disconnect());
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tickAnim);
}

init();
