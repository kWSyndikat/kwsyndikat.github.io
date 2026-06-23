"use strict";

const VESC = {
  serviceUuid: "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
  rxUuid: "6e400002-b5a3-f393-e0a9-e50e24dcca9e",
  txUuid: "6e400003-b5a3-f393-e0a9-e50e24dcca9e",
  commGetValues: 4
};

const els = {
  connectButton: document.getElementById("connectButton"),
  demoToggle: document.getElementById("demoToggle"),
  connectionState: document.getElementById("connectionState"),
  packetState: document.getElementById("packetState"),
  speedArc: document.getElementById("speedArc"),
  speedValue: document.getElementById("speedValue"),
  batteryValue: document.getElementById("batteryValue"),
  batteryFill: document.getElementById("batteryFill"),
  powerValue: document.getElementById("powerValue"),
  currentValue: document.getElementById("currentValue"),
  dutyValue: document.getElementById("dutyValue"),
  mosfetNow: document.getElementById("mosfetNow"),
  mosfetAvg: document.getElementById("mosfetAvg"),
  mosfetMax: document.getElementById("mosfetMax"),
  escTemp: document.getElementById("escTemp"),
  motorTemp: document.getElementById("motorTemp"),
  escTempBar: document.getElementById("escTempBar"),
  motorTempBar: document.getElementById("motorTempBar"),
  distanceValue: document.getElementById("distanceValue"),
  ahValue: document.getElementById("ahValue"),
  consumptionValue: document.getElementById("consumptionValue"),
  whTrip: document.getElementById("whTrip"),
  rpmValue: document.getElementById("rpmValue"),
  wheelDiameter: document.getElementById("wheelDiameter"),
  motorPoles: document.getElementById("motorPoles"),
  gearRatio: document.getElementById("gearRatio"),
  batteryMax: document.getElementById("batteryMax"),
  batteryMin: document.getElementById("batteryMin")
};

const state = {
  device: null,
  rx: null,
  tx: null,
  pollTimer: 0,
  demoTimer: 0,
  demo: false,
  rxBuffer: [],
  lastUpdate: 0,
  tripKm: 0,
  whTrip: 0,
  ahBase: null,
  whBase: null,
  mosfetSamples: [],
  mosfetMax: null
};

els.connectButton.addEventListener("click", connectVesc);
els.demoToggle.addEventListener("click", toggleDemo);

function numberInput(id, fallback) {
  const value = Number(els[id].value);
  return Number.isFinite(value) ? value : fallback;
}

async function connectVesc() {
  if (!navigator.bluetooth) {
    setStatus("Offline", "Web Bluetooth ist in diesem Browser nicht verfügbar", "offline");
    return;
  }

  try {
    stopDemo();
    setStatus("Suche", "Bluetooth-Gerät auswählen", "demo");

    state.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [VESC.serviceUuid] }],
      optionalServices: [VESC.serviceUuid]
    });

    state.device.addEventListener("gattserverdisconnected", handleDisconnect);
    const server = await state.device.gatt.connect();
    const service = await server.getPrimaryService(VESC.serviceUuid);
    state.rx = await service.getCharacteristic(VESC.rxUuid);
    state.tx = await service.getCharacteristic(VESC.txUuid);

    await state.tx.startNotifications();
    state.tx.addEventListener("characteristicvaluechanged", handleNotification);

    setStatus("Online", state.device.name || "VESC verbunden", "online");
    pollValues();
    state.pollTimer = window.setInterval(pollValues, 220);
  } catch (error) {
    setStatus("Offline", error.message || "BLE-Verbindung abgebrochen", "offline");
  }
}

function handleDisconnect() {
  window.clearInterval(state.pollTimer);
  setStatus("Offline", "VESC getrennt", "offline");
}

function pollValues() {
  if (!state.rx) {
    return;
  }
  const packet = buildPacket(new Uint8Array([VESC.commGetValues]));
  state.rx.writeValueWithoutResponse(packet).catch(() => {
    state.rx.writeValue(packet).catch((error) => setStatus("Offline", error.message, "offline"));
  });
}

function buildPacket(payload) {
  const crc = crc16(payload);
  const packet = new Uint8Array(payload.length + 5);
  packet[0] = 2;
  packet[1] = payload.length;
  packet.set(payload, 2);
  packet[packet.length - 3] = (crc >> 8) & 255;
  packet[packet.length - 2] = crc & 255;
  packet[packet.length - 1] = 3;
  return packet;
}

function handleNotification(event) {
  const chunk = new Uint8Array(event.target.value.buffer);
  for (const byte of chunk) {
    state.rxBuffer.push(byte);
  }
  drainPackets();
}

function drainPackets() {
  while (state.rxBuffer.length >= 5) {
    const start = state.rxBuffer.indexOf(2);
    if (start < 0) {
      state.rxBuffer.length = 0;
      return;
    }
    if (start > 0) {
      state.rxBuffer.splice(0, start);
    }

    const length = state.rxBuffer[1];
    const packetLength = length + 5;
    if (state.rxBuffer.length < packetLength) {
      return;
    }

    const raw = state.rxBuffer.splice(0, packetLength);
    if (raw[packetLength - 1] !== 3) {
      continue;
    }

    const payload = new Uint8Array(raw.slice(2, 2 + length));
    const packetCrc = (raw[packetLength - 3] << 8) | raw[packetLength - 2];
    if (crc16(payload) !== packetCrc) {
      setStatus("Online", "CRC Fehler im Datenpaket", "online");
      continue;
    }

    const values = parseGetValues(payload);
    if (values) {
      render(values);
      setStatus("Online", "Live-Daten empfangen", "online");
    }
  }
}

function parseGetValues(payload) {
  if (payload[0] !== VESC.commGetValues || payload.length < 55) {
    return null;
  }

  let i = 1;
  const readInt16 = () => {
    const value = (payload[i] << 8) | payload[i + 1];
    i += 2;
    return value & 0x8000 ? value - 0x10000 : value;
  };
  const readInt32 = () => {
    const value = (payload[i] << 24) | (payload[i + 1] << 16) | (payload[i + 2] << 8) | payload[i + 3];
    i += 4;
    return value;
  };
  const readByte = () => payload[i++];

  const tempMosfet = readInt16() / 10;
  const tempMotor = readInt16() / 10;
  const currentMotor = readInt32() / 100;
  const currentIn = readInt32() / 100;
  readInt32();
  readInt32();
  const duty = readInt16() / 1000;
  const erpm = readInt32();
  const voltage = readInt16() / 10;
  const ampHours = readInt32() / 10000;
  readInt32();
  const wattHours = readInt32() / 10000;
  readInt32();
  const tachometer = readInt32();
  const tachometerAbs = readInt32();
  const faultCode = readByte();

  return {
    tempMosfet,
    tempMotor,
    currentMotor,
    currentIn,
    duty,
    erpm,
    voltage,
    ampHours,
    wattHours,
    tachometer,
    tachometerAbs,
    faultCode
  };
}

function render(values) {
  const now = performance.now();
  const dtHours = state.lastUpdate ? (now - state.lastUpdate) / 3600000 : 0;
  state.lastUpdate = now;

  const mechanicalRpm = erpmToMechanicalRpm(values.erpm);
  const speed = rpmToKmh(mechanicalRpm);
  const power = values.voltage * values.currentIn;
  const distanceDelta = speed * dtHours;

  if (dtHours > 0 && dtHours < 0.01) {
    state.tripKm += Math.max(0, distanceDelta);
    state.whTrip += Math.max(0, power * dtHours);
  }

  if (state.ahBase === null) {
    state.ahBase = values.ampHours;
  }
  if (state.whBase === null) {
    state.whBase = values.wattHours;
  }

  state.mosfetSamples.push(values.tempMosfet);
  if (state.mosfetSamples.length > 300) {
    state.mosfetSamples.shift();
  }
  state.mosfetMax = state.mosfetMax === null ? values.tempMosfet : Math.max(state.mosfetMax, values.tempMosfet);

  const mosfetAvg = average(state.mosfetSamples);
  const ahDrawn = Math.max(0, values.ampHours - state.ahBase);
  const whDrawn = Math.max(state.whTrip, Math.max(0, values.wattHours - state.whBase));
  const consumption = state.tripKm > 0.02 ? whDrawn / state.tripKm : null;

  setText(els.speedValue, Math.round(Math.abs(speed)));
  setText(els.batteryValue, format(values.voltage, 1));
  setText(els.powerValue, Math.round(power));
  setText(els.currentValue, format(values.currentIn, 1));
  setText(els.dutyValue, format(values.duty * 100, 1));
  setText(els.mosfetNow, format(values.tempMosfet, 1));
  setText(els.mosfetAvg, format(mosfetAvg, 1));
  setText(els.mosfetMax, format(state.mosfetMax, 1));
  setText(els.escTemp, format(values.tempMosfet, 1));
  setText(els.motorTemp, format(values.tempMotor, 1));
  setText(els.distanceValue, format(state.tripKm, 2));
  setText(els.ahValue, format(ahDrawn, 3));
  setText(els.consumptionValue, consumption === null ? "--" : format(consumption, 1));
  setText(els.whTrip, format(whDrawn, 1));
  setText(els.rpmValue, Math.round(mechanicalRpm));

  setGauge(speed);
  setBattery(values.voltage);
  setBar(els.escTempBar, values.tempMosfet, 35, 95);
  setBar(els.motorTempBar, values.tempMotor, 35, 110);
}

function erpmToMechanicalRpm(erpm) {
  const poles = Math.max(2, numberInput("motorPoles", 14));
  return erpm / (poles / 2);
}

function rpmToKmh(rpm) {
  const diameterMeters = Math.max(0.01, numberInput("wheelDiameter", 90) / 1000);
  const ratio = Math.max(0.1, numberInput("gearRatio", 1));
  const circumference = Math.PI * diameterMeters;
  return (rpm / ratio) * circumference * 60 / 1000;
}

function setGauge(speed) {
  const maxSpeed = 85;
  const percent = clamp(Math.abs(speed) / maxSpeed, 0, 1);
  const circumference = 622;
  els.speedArc.style.strokeDashoffset = String(circumference - circumference * percent);
}

function setBattery(voltage) {
  const min = numberInput("batteryMin", 36);
  const max = numberInput("batteryMax", 50.4);
  const percent = clamp((voltage - min) / Math.max(1, max - min), 0, 1) * 100;
  els.batteryFill.style.width = `${percent}%`;
}

function setBar(el, value, min, max) {
  const percent = clamp((value - min) / (max - min), 0, 1) * 100;
  el.style.width = `${percent}%`;
}

function toggleDemo() {
  if (state.demo) {
    stopDemo();
    setStatus("Offline", "Demo gestoppt", "offline");
    return;
  }

  if (state.device?.gatt?.connected) {
    state.device.gatt.disconnect();
  }

  state.demo = true;
  state.lastUpdate = 0;
  setStatus("Demo", "Synthetische Live-Daten", "demo");
  state.demoTimer = window.setInterval(renderDemoFrame, 160);
}

function stopDemo() {
  state.demo = false;
  window.clearInterval(state.demoTimer);
}

function renderDemoFrame() {
  const t = performance.now() / 1000;
  const throttle = (Math.sin(t * 0.72) + 1) / 2;
  const erpm = 3800 + throttle * 24500 + Math.sin(t * 2.3) * 1200;
  const current = 8 + throttle * 42 + Math.sin(t * 3.2) * 2.4;
  const voltage = 47.8 - (Math.sin(t * 0.08) + 1) * 1.9 - throttle * 0.4;

  render({
    tempMosfet: 38 + throttle * 27 + Math.sin(t * 1.7) * 2.2,
    tempMotor: 34 + throttle * 31 + Math.cos(t * 1.3) * 2.8,
    currentMotor: current * 1.4,
    currentIn: current,
    duty: 0.12 + throttle * 0.74,
    erpm,
    voltage,
    ampHours: 1.5 + t * current / 3600,
    wattHours: 65 + t * voltage * current / 3600,
    tachometer: Math.round(t * erpm / 60),
    tachometerAbs: Math.round(t * Math.abs(erpm) / 60),
    faultCode: 0
  });
}

function setStatus(label, detail, mode) {
  els.connectionState.textContent = label;
  els.connectionState.className = `state-pill ${mode}`;
  els.packetState.textContent = detail;
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function format(value, digits) {
  return Number.isFinite(value) ? value.toFixed(digits) : "--";
}

function setText(el, value) {
  el.textContent = String(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function crc16(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc;
}

if (!navigator.bluetooth) {
  setStatus("Offline", "Chrome/Edge mit Web Bluetooth nutzen", "offline");
}
