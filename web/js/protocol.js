/**
 * Ninebot / Xiaomi M365 serial framing (55 AA …) over Nordic UART BLE.
 * Documented community protocol (same family as Mi Home / third-party apps).
 */

export function checksumFromLengthByte(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) sum = (sum + bytes[i]) & 0xffff;
  return sum ^ 0xffff;
}

/** Build read: master→scooter D=0x20 T=0x01 */
export function buildReadScooter(cmd, param = 0) {
  const L = 3;
  const body = new Uint8Array([L, 0x20, 0x01, cmd & 0xff, param & 0xff]);
  return finalizeFrame(body);
}

/** Build read: master→BMS D=0x22 T=0x01 */
export function buildReadBms(cmd, param = 0) {
  const L = 3;
  const body = new Uint8Array([L, 0x22, 0x01, cmd & 0xff, param & 0xff]);
  return finalizeFrame(body);
}

/** Build write: master→scooter D=0x20 T=0x03 */
export function buildWriteScooter(cmd, payloadLe) {
  const pl = payloadLe instanceof Uint8Array ? payloadLe : new Uint8Array(payloadLe);
  const L = 2 + pl.length;
  const inner = new Uint8Array(2 + L);
  inner[0] = L;
  inner[1] = 0x20;
  inner[2] = 0x03;
  inner[3] = cmd & 0xff;
  inner.set(pl, 4);
  return finalizeFrame(inner);
}

function finalizeFrame(bodyWithLen) {
  const ck = checksumFromLengthByte(bodyWithLen);
  const out = new Uint8Array(2 + bodyWithLen.length + 2);
  out[0] = 0x55;
  out[1] = 0xaa;
  out.set(bodyWithLen, 2);
  out[2 + bodyWithLen.length] = ck & 0xff;
  out[2 + bodyWithLen.length + 1] = (ck >> 8) & 0xff;
  return out;
}

export function parseFrames(buffer) {
  const frames = [];
  let i = 0;
  while (i < buffer.length) {
    if (buffer[i] !== 0x55 || buffer[i + 1] !== 0xaa) {
      i++;
      continue;
    }
    if (i + 3 > buffer.length) break;
    const Lfield = buffer[i + 2];
    if (Lfield > 220) {
      i++;
      continue;
    }
    const total = 6 + Lfield;
    if (total < 9 || i + total > buffer.length) break;
    const frame = buffer.slice(i, i + total);
    const body = frame.slice(2, 2 + 2 + Lfield);
    const ck = checksumFromLengthByte(body);
    const got = frame[2 + 2 + Lfield] | (frame[2 + 2 + Lfield + 1] << 8);
    if (ck !== got) {
      i++;
      continue;
    }
    frames.push(frame);
    i += total;
  }
  return { frames, consumed: i };
}

/** @param {Uint8Array} frame full 55 aa frame */
export function interpretFrame(frame) {
  if (frame.length < 9) return null;
  const Lfield = frame[2];
  const D = frame[3];
  if (frame.length < 6 + Lfield) return null;
  const T = frame[4];
  const C = frame[5];
  const payload = frame.slice(6, 4 + Lfield);
  return { L: Lfield, D, T, C, payload, raw: frame };
}

/**
 * Parse 0xB0 scooter status (response from scooter, D=0x23).
 * Offsets are uint16 little-endian pairs starting at Var176.
 */
export function parseB0Payload(payload) {
  if (payload.length < 32) return null;
  const v = (n) => {
    const o = (n - 176) * 2;
    if (o + 1 >= payload.length) return 0;
    return payload[o] | (payload[o + 1] << 8);
  };
  return {
    errorFlags: v(176),
    warnFlags: v(177),
    flags: v(178),
    workMode: v(179),
    batteryPct: v(180) & 0xff,
    speedMh: v(181),
    avgSpeedMh: v(182),
    odometerM: v(183) | (v(184) << 16),
    u185: v(185),
    rideTimeSec: v(186),
    tempX10: v(187),
    speedKmh: v(181) / 1000,
    avgKmh: v(182) / 1000,
  };
}

/**
 * BMS 0x31 batch: mAh remain, %, current(cA), voltage(mV), temp — layout from community dumps.
 */
export function parseBms31(payload) {
  if (payload.length < 10) return null;
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return {
    mAhLeft: dv.getUint16(0, true),
    percent: dv.getUint16(2, true) & 0xff,
    currentCA: dv.getInt16(4, true),
    voltageMv: dv.getUint16(6, true),
    temp: dv.getInt16(8, true),
    currentA: dv.getInt16(4, true) / 100,
    voltageV: dv.getUint16(6, true) / 1000,
    watts: (dv.getUint16(6, true) / 1000) * (dv.getInt16(4, true) / 100),
  };
}

export function parseTrip3a(payload) {
  if (payload.length < 4) return null;
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return {
    tripSec: dv.getUint16(0, true),
    tripM: dv.getUint16(2, true),
  };
}

export function parseRange25(payload) {
  if (payload.length < 2) return null;
  const raw = payload[0] | (payload[1] << 8);
  return { rangeKm: raw / 10 };
}
