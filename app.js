"use strict";

const VESC = {
  serviceUuid: "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
  rxUuid: "6e400002-b5a3-f393-e0a9-e50e24dcca9e",
  txUuid: "6e400003-b5a3-f393-e0a9-e50e24dcca9e",
  commGetValues: 4,
  commGetMcconf: 14,
  commGetAppconf: 17,
  commSetMcconfTempSetup: 49,
  commGetMcconfTemp: 91
};

const els = {
  connectButton: document.getElementById("connectButton"),
  disconnectButton: document.getElementById("disconnectButton"),
  gateState: document.getElementById("gateState"),
  profileButton: document.getElementById("profileButton"),
  profilePanel: document.getElementById("profilePanel"),
  profileClose: document.getElementById("profileClose"),
  profileList: document.getElementById("profileList"),
  profileState: document.getElementById("profileState"),
  panicUntilReboot: document.getElementById("panicUntilReboot"),
  panicPermanent: document.getElementById("panicPermanent"),
  connectionState: document.getElementById("connectionState"),
  packetState: document.getElementById("packetState"),
  speedHold: document.getElementById("speedHold"),
  speedSource: document.getElementById("speedSource"),
  speedArc: document.getElementById("speedArc"),
  speedValue: document.getElementById("speedValue"),
  batteryValue: document.getElementById("batteryValue"),
  batteryFill: document.getElementById("batteryFill"),
  batteryPercent: document.getElementById("batteryPercent"),
  batteryRange: document.getElementById("batteryRange"),
  powerValue: document.getElementById("powerValue"),
  currentValue: document.getElementById("currentValue"),
  dutyValue: document.getElementById("dutyValue"),
  mosfetNow: document.getElementById("mosfetNow"),
  mosfetAvg: document.getElementById("mosfetAvg"),
  mosfetMax: document.getElementById("mosfetMax"),
  escTemp: document.getElementById("escTemp"),
  motorTemp: document.getElementById("motorTemp"),
  distanceValue: document.getElementById("distanceValue"),
  ahValue: document.getElementById("ahValue"),
  consumptionValue: document.getElementById("consumptionValue"),
  whTrip: document.getElementById("whTrip"),
  rpmValue: document.getElementById("rpmValue"),
  configPoles: document.getElementById("configPoles"),
  configGear: document.getElementById("configGear"),
  configWheel: document.getElementById("configWheel"),
  configApp: document.getElementById("configApp"),
  configBattery: document.getElementById("configBattery")
};

const state = {
  device: null,
  rx: null,
  tx: null,
  pollTimer: 0,
  demoTimer: 0,
  holdTimer: 0,
  holdRaf: 0,
  tapTimes: [],
  swipeStartX: 0,
  swipeStartY: 0,
  watchId: null,
  writeQueue: Promise.resolve(),
  demo: false,
  gpsSpeedActive: false,
  gpsSpeedKmh: null,
  rxBuffer: [],
  lastUpdate: 0,
  tripKm: 0,
  whTrip: 0,
  ahBase: null,
  whBase: null,
  mosfetSamples: [],
  mosfetMax: null,
  profiles: [],
  activeProfile: null,
  config: {
    motorPoles: 14,
    gearRatio: 1,
    wheelDiameter: 0.09,
    minVoltage: 36,
    maxVoltage: 50.4,
    batteryCutStart: null,
    batteryCutEnd: null,
    batteryCells: null,
    batteryAh: null,
    maxErpm: 60000,
    mcconf: false,
    appconf: false,
    mcconfTemp: false
  }
};

els.connectButton.addEventListener("click", connectVesc);
els.disconnectButton.addEventListener("click", disconnectVesc);
els.profileButton.addEventListener("click", () => toggleProfiles(true));
els.profileClose.addEventListener("click", () => toggleProfiles(false));
els.panicUntilReboot.addEventListener("click", () => requestPanicProfile("until reboot"));
els.panicPermanent.addEventListener("click", () => requestPanicProfile("permanently"));
els.speedHold.addEventListener("pointerdown", startSpeedHold);
els.speedHold.addEventListener("pointerup", cancelSpeedHold);
els.speedHold.addEventListener("pointercancel", cancelSpeedHold);
els.speedHold.addEventListener("pointerleave", cancelSpeedHold);
els.speedHold.addEventListener("click", trackSpeedTap);
document.addEventListener("touchstart", beginSwipe, { passive: true });
document.addEventListener("touchend", endSwipe, { passive: true });

initHellCanvas();
loadProfiles();
renderConfig();

async function connectVesc() {
  if (!navigator.bluetooth) {
    setStatus("Offline", "Chrome/Edge with Web Bluetooth", "offline");
    return;
  }

  try {
    setStatus("Search", "Select VESC BLE device", "demo");
    setGateState("Select VESC BLE device");

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

    setStatus("Online", state.device.name || "VESC connected", "online");
    document.body.classList.add("connected");
    setGateState("Connected");
    await requestVescConfig();
    pollValues();
    state.pollTimer = window.setInterval(pollValues, 220);
  } catch (error) {
    setStatus("Offline", error.message || "BLE connection cancelled", "offline");
    setGateState(error.message || "BLE connection cancelled");
  }
}

function handleDisconnect() {
  window.clearInterval(state.pollTimer);
  state.rx = null;
  state.tx = null;
  document.body.classList.remove("connected");
  toggleProfiles(false);
  setStatus("Offline", "VESC disconnected", "offline");
  setGateState("Disconnected");
}

function disconnectVesc() {
  if (state.device?.gatt?.connected) {
    state.device.gatt.disconnect();
    return;
  }
  handleDisconnect();
}

async function requestVescConfig() {
  setStatus("Config", "Reading motor and app config", "demo");
  await sendCommand(VESC.commGetMcconfTemp);
  await sendCommand(VESC.commGetMcconf);
  await sendCommand(VESC.commGetAppconf);
  ensurePanicProfile();
}

function pollValues() {
  sendCommand(VESC.commGetValues);
}

function sendCommand(commandId) {
  if (!state.rx) {
    return Promise.resolve();
  }

  return sendPayload(new Uint8Array([commandId]));
}

function sendPayload(payload) {
  if (!state.rx) {
    return Promise.resolve();
  }

  const packet = buildPacket(payload);
  state.writeQueue = state.writeQueue.then(() => state.rx.writeValueWithoutResponse(packet).catch(() => state.rx.writeValue(packet))).catch((error) => {
    setStatus("Offline", error.message, "offline");
  });
  return state.writeQueue;
}

function buildPacket(payload) {
  const crc = crc16(payload);
  if (payload.length < 256) {
    const packet = new Uint8Array(payload.length + 5);
    packet[0] = 2;
    packet[1] = payload.length;
    packet.set(payload, 2);
    packet[packet.length - 3] = (crc >> 8) & 255;
    packet[packet.length - 2] = crc & 255;
    packet[packet.length - 1] = 3;
    return packet;
  }

  const packet = new Uint8Array(payload.length + 6);
  packet[0] = 3;
  packet[1] = (payload.length >> 8) & 255;
  packet[2] = payload.length & 255;
  packet.set(payload, 3);
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
    const startShort = state.rxBuffer.indexOf(2);
    const startLong = state.rxBuffer.indexOf(3);
    const starts = [startShort, startLong].filter((value) => value >= 0);
    if (!starts.length) {
      state.rxBuffer.length = 0;
      return;
    }

    const start = Math.min(...starts);
    if (start > 0) {
      state.rxBuffer.splice(0, start);
    }

    const isLong = state.rxBuffer[0] === 3;
    const header = isLong ? 3 : 2;
    if (state.rxBuffer.length < header + 3) {
      return;
    }

    const length = isLong ? (state.rxBuffer[1] << 8) | state.rxBuffer[2] : state.rxBuffer[1];
    const packetLength = length + header + 3;
    if (state.rxBuffer.length < packetLength) {
      return;
    }

    const raw = state.rxBuffer.splice(0, packetLength);
    if (raw[packetLength - 1] !== 3) {
      continue;
    }

    const payload = new Uint8Array(raw.slice(header, header + length));
    const packetCrc = (raw[packetLength - 3] << 8) | raw[packetLength - 2];
    if (crc16(payload) !== packetCrc) {
      setStatus("Online", "CRC error", "online");
      continue;
    }

    handlePayload(payload);
  }
}

function handlePayload(payload) {
  switch (payload[0]) {
    case VESC.commGetValues: {
      const values = parseGetValues(payload);
      if (values) {
        render(values);
        setStatus(state.gpsSpeedActive ? "GPS" : "Online", state.gpsSpeedActive ? "GPS speed active" : "Live values", state.gpsSpeedActive ? "demo" : "online");
      }
      break;
    }
    case VESC.commGetMcconfTemp:
      parseMcconfTemp(payload);
      break;
    case VESC.commGetMcconf:
      parseMcconf(payload);
      break;
    case VESC.commGetAppconf:
      state.config.appconf = true;
      renderConfig();
      break;
    default:
      break;
  }
}

function parseGetValues(payload) {
  if (payload.length < 55) {
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

function parseMcconfTemp(payload) {
  if (payload.length < 50) {
    return;
  }

  let i = 1;
  const readAuto = () => readFloat32Auto(payload, (next) => { i = next; }, i);
  const currentMinScale = readAuto();
  const currentMaxScale = readAuto();
  const erpmOrSpeedMin = readAuto();
  const erpmOrSpeedMax = readAuto();
  const dutyMin = readAuto();
  const dutyMax = readAuto();
  const wattMin = readAuto();
  const wattMax = readAuto();
  const inCurrentMin = readAuto();
  const inCurrentMax = readAuto();

  const poles = payload[i++];
  const gearRatio = readAuto();
  const wheelDiameter = readAuto();

  if (poles >= 2 && poles <= 80) {
    state.config.motorPoles = poles;
  }
  if (gearRatio > 0 && gearRatio < 30) {
    state.config.gearRatio = gearRatio;
  }
  if (wheelDiameter > 0.03 && wheelDiameter < 2) {
    state.config.wheelDiameter = wheelDiameter;
  }
  if (erpmOrSpeedMax > 1000) {
    state.config.maxErpm = erpmOrSpeedMax;
  }
  state.activeProfile = {
    name: "Current VESC",
    currentMinScale,
    currentMaxScale,
    speedMin: erpmToKmh(erpmToMechanicalRpm(erpmOrSpeedMin)) / 3.6,
    speedMax: erpmToKmh(erpmToMechanicalRpm(erpmOrSpeedMax)) / 3.6,
    dutyMin,
    dutyMax,
    wattMin,
    wattMax,
    inCurrentMin,
    inCurrentMax,
    isCurrent: true
  };
  state.config.mcconfTemp = true;
  ensurePanicProfile();
  renderConfig();
  renderProfiles();
}

function parseMcconf(payload) {
  if (payload.length < 60) {
    return;
  }

  let i = 1;
  const skip = (count) => { i += count; };
  const readAuto = () => readFloat32Auto(payload, (next) => { i = next; }, i);
  const readFloat16 = (scale) => {
    const value = (((payload[i] << 8) | payload[i + 1]) << 16) >> 16;
    i += 2;
    return value / scale;
  };

  skip(4);
  skip(4);
  readAuto();
  readAuto();
  readAuto();
  readAuto();
  readFloat16(10000);
  readFloat16(10000);
  readAuto();
  readAuto();
  const maxErpm = readAuto();
  readFloat16(10000);
  readAuto();
  readAuto();

  const minVoltage = readFloat16(10);
  const maxVoltage = readFloat16(10);
  const cutStart = readFloat16(10);
  const cutEnd = readFloat16(10);

  if (minVoltage > 5 && minVoltage < 140) {
    state.config.minVoltage = minVoltage;
  }
  if (maxVoltage > state.config.minVoltage && maxVoltage < 160) {
    state.config.maxVoltage = maxVoltage;
  }
  if (cutStart > 5 && cutStart < 140) {
    state.config.batteryCutStart = cutStart;
  }
  if (cutEnd > 5 && cutEnd < 140) {
    state.config.batteryCutEnd = cutEnd;
  }
  if (maxErpm > 1000) {
    state.config.maxErpm = maxErpm;
  }
  parseMcconfSetup(payload);
  state.config.mcconf = true;
  renderConfig();
}

function parseMcconfSetup(payload) {
  try {
    let i = 1;
    const byte = () => payload[i++];
    const skip = (count) => { i += count; };
    const auto = () => readFloat32Auto(payload, (next) => { i = next; }, i);
    const f16 = () => { i += 2; };

    skip(4);
    skip(4);
    for (let n = 0; n < 4; n++) auto();
    f16(); f16();
    auto(); auto();
    const maxErpm = auto();
    f16();
    auto(); auto();
    for (let n = 0; n < 6; n++) f16();
    skip(5);
    f16(); f16(); f16();
    auto(); auto();
    f16(); f16(); f16();
    byte();
    auto(); auto(); auto();
    f16(); f16();
    auto(); auto();
    skip(8);
    for (let n = 0; n < 5; n++) auto();
    byte();
    auto(); auto();
    byte();
    for (let n = 0; n < 8; n++) auto();
    f16();
    auto(); auto();
    f16();
    auto(); auto();
    for (let n = 0; n < 7; n++) f16();
    skip(8);
    auto(); auto(); auto();
    skip(3);
    f16();
    byte();
    f16(); f16();
    skip(3);
    f16();
    byte();
    for (let n = 0; n < 6; n++) f16();
    auto(); auto();
    skip(2);
    auto();
    skip(2);
    auto(); auto(); auto();
    for (let n = 0; n < 6; n++) f16();
    skip(2);
    auto();
    byte();
    auto();
    for (let n = 0; n < 4; n++) f16();
    skip(2);
    f16(); f16();
    byte();
    auto(); auto(); auto();
    f16();
    auto();
    byte();
    auto();
    byte();
    auto(); auto(); auto(); auto();
    f16();
    auto();
    f16();
    auto();
    f16();
    auto(); auto();
    f16();
    skip(4);
    f16();
    auto();
    skip(4);
    for (let n = 0; n < 6; n++) f16();
    skip(4);
    auto(); auto(); auto(); auto();
    skip(2);
    auto();
    f16(); f16();
    skip(2);

    const poles = byte();
    const gearRatio = auto();
    const wheelDiameter = auto();
    byte();
    const batteryCells = byte();
    const batteryAh = auto();

    if (maxErpm > 1000) state.config.maxErpm = maxErpm;
    if (poles >= 2 && poles <= 80) state.config.motorPoles = poles;
    if (gearRatio > 0 && gearRatio < 30) state.config.gearRatio = gearRatio;
    if (wheelDiameter > 0.03 && wheelDiameter < 2) state.config.wheelDiameter = wheelDiameter;
    if (batteryCells > 0 && batteryCells <= 40) state.config.batteryCells = batteryCells;
    if (batteryAh > 0 && batteryAh < 1000) state.config.batteryAh = batteryAh;
  } catch (error) {
    setStatus("Config", "Battery setup parse fallback", "demo");
  }
}

function render(values) {
  const now = performance.now();
  const dtHours = state.lastUpdate ? (now - state.lastUpdate) / 3600000 : 0;
  state.lastUpdate = now;

  const mechanicalRpm = erpmToMechanicalRpm(values.erpm);
  const vescSpeed = rpmToKmh(mechanicalRpm);
  const displaySpeed = state.gpsSpeedActive && state.gpsSpeedKmh !== null ? state.gpsSpeedKmh : vescSpeed;
  const power = values.voltage * values.currentIn;

  if (dtHours > 0 && dtHours < 0.01) {
    state.tripKm += Math.max(0, displaySpeed * dtHours);
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

  setText(els.speedValue, Math.round(Math.abs(displaySpeed)));
  setText(els.speedSource, state.gpsSpeedActive ? "GPS km/h" : "VESC km/h");
  setText(els.batteryValue, format(values.voltage, 1));
  setText(els.powerValue, Math.round(power));
  setText(els.currentValue, format(values.currentIn, 1));
  setText(els.dutyValue, format(values.duty * 100, 0));
  setText(els.mosfetNow, format(values.tempMosfet, 0));
  setText(els.mosfetAvg, format(mosfetAvg, 0));
  setText(els.mosfetMax, format(state.mosfetMax, 0));
  setText(els.escTemp, format(values.tempMosfet, 0));
  setText(els.motorTemp, format(values.tempMotor, 0));
  setText(els.distanceValue, format(state.tripKm, 2));
  setText(els.ahValue, format(ahDrawn, 3));
  setText(els.consumptionValue, consumption === null ? "--" : format(consumption, 1));
  setText(els.whTrip, format(whDrawn, 1));
  setText(els.rpmValue, Math.round(mechanicalRpm));

  setGauge(displaySpeed);
  setBattery(values.voltage);
}

function erpmToMechanicalRpm(erpm) {
  return erpm / (Math.max(2, state.config.motorPoles) / 2);
}

function rpmToKmh(rpm) {
  const circumference = Math.PI * Math.max(0.01, state.config.wheelDiameter);
  return (rpm / Math.max(0.1, state.config.gearRatio)) * circumference * 60 / 1000;
}

function setGauge(speed) {
  const maxSpeed = Math.max(45, rpmToKmh(erpmToMechanicalRpm(state.config.maxErpm)));
  const percent = clamp(Math.abs(speed) / maxSpeed, 0, 1);
  const circumference = 622;
  els.speedArc.style.strokeDashoffset = String(circumference - circumference * percent);
}

function setBattery(voltage) {
  const percent = estimateBatteryPercent(voltage);
  els.batteryFill.style.width = `${percent}%`;
  setText(els.batteryPercent, `${Math.round(percent)}%`);
}

function estimateBatteryPercent(voltage) {
  const cells = state.config.batteryCells;
  if (cells) {
    return estimateLithiumPercent(voltage / cells);
  }
  const min = state.config.batteryCutEnd || state.config.minVoltage;
  const max = state.config.maxVoltage;
  return clamp((voltage - min) / Math.max(1, max - min), 0, 1) * 100;
}

function estimateLithiumPercent(cellVoltage) {
  const curve = [
    [3.0, 0], [3.2, 5], [3.45, 15], [3.6, 32], [3.7, 50],
    [3.82, 68], [3.92, 80], [4.05, 92], [4.2, 100]
  ];
  if (cellVoltage <= curve[0][0]) return 0;
  if (cellVoltage >= curve[curve.length - 1][0]) return 100;
  for (let i = 1; i < curve.length; i++) {
    const [v2, p2] = curve[i];
    const [v1, p1] = curve[i - 1];
    if (cellVoltage <= v2) {
      const mix = (cellVoltage - v1) / (v2 - v1);
      return p1 + (p2 - p1) * mix;
    }
  }
  return 0;
}

function startSpeedHold(event) {
  event.preventDefault();
  els.speedHold.setPointerCapture?.(event.pointerId);
  const started = performance.now();
  els.speedHold.classList.add("holding");
  animateHold(started);
  state.holdTimer = window.setTimeout(() => {
    cancelSpeedHold();
    toggleGpsSpeed();
  }, 3000);
}

function cancelSpeedHold() {
  window.clearTimeout(state.holdTimer);
  cancelAnimationFrame(state.holdRaf);
  els.speedHold.classList.remove("holding");
  els.speedHold.style.setProperty("--hold", "0%");
}

function animateHold(started) {
  const elapsed = performance.now() - started;
  const percent = clamp(elapsed / 3000, 0, 1) * 100;
  els.speedHold.style.setProperty("--hold", `${percent}%`);
  if (percent < 100) {
    state.holdRaf = requestAnimationFrame(() => animateHold(started));
  }
}

function toggleGpsSpeed() {
  if (state.gpsSpeedActive) {
    state.gpsSpeedActive = false;
    els.speedHold.classList.remove("gps-active");
    if (state.watchId !== null) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
    }
    setStatus(state.device?.gatt?.connected ? "Online" : "Offline", "VESC speed active", state.device?.gatt?.connected ? "online" : "offline");
    return;
  }

  if (!navigator.geolocation) {
    setStatus("Offline", "GPS not available", "offline");
    return;
  }

  state.gpsSpeedActive = true;
  els.speedHold.classList.add("gps-active");
  setStatus("GPS", "Waiting for location speed", "demo");
  state.watchId = navigator.geolocation.watchPosition((position) => {
    const speedMs = position.coords.speed;
    if (Number.isFinite(speedMs)) {
      state.gpsSpeedKmh = Math.max(0, speedMs * 3.6);
      setStatus("GPS", "GPS speed active", "demo");
    }
  }, (error) => {
    state.gpsSpeedActive = false;
    els.speedHold.classList.remove("gps-active");
    setStatus(state.device?.gatt?.connected ? "Online" : "Offline", error.message || "GPS blocked", state.device?.gatt?.connected ? "online" : "offline");
  }, {
    enableHighAccuracy: true,
    maximumAge: 700,
    timeout: 8000
  });
}

function beginSwipe(event) {
  const touch = event.changedTouches[0];
  state.swipeStartX = touch.clientX;
  state.swipeStartY = touch.clientY;
}

function endSwipe(event) {
  if (!document.body.classList.contains("connected")) {
    return;
  }
  const touch = event.changedTouches[0];
  const dx = touch.clientX - state.swipeStartX;
  const dy = touch.clientY - state.swipeStartY;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    toggleProfiles(dx < 0);
  }
}

function toggleProfiles(open) {
  els.profilePanel.classList.toggle("open", open);
  if (open) {
    refreshProfiles();
  }
}

function refreshProfiles() {
  ensurePanicProfile();
  renderProfiles();
  setText(els.profileState, "Profiles are mcconf_temp sets. Until reboot = RAM, permanently = flash.");
}

function loadProfiles() {
  try {
    const saved = JSON.parse(localStorage.getItem("vescometerProfiles") || "[]");
    state.profiles = Array.isArray(saved) ? saved : [];
  } catch (error) {
    state.profiles = [];
  }
  ensurePanicProfile();
}

function saveProfiles() {
  localStorage.setItem("vescometerProfiles", JSON.stringify(state.profiles));
}

function ensurePanicProfile() {
  if (state.profiles.some((profile) => profile.name === "VESCOMETERPANIC")) {
    return;
  }

  const base = state.activeProfile || {
    currentMinScale: 1,
    currentMaxScale: 1,
    dutyMin: -0.95,
    dutyMax: 0.95,
    inCurrentMin: -60,
    inCurrentMax: 60
  };

  state.profiles.unshift({
    name: "VESCOMETERPANIC",
    currentMinScale: base.currentMinScale,
    currentMaxScale: base.currentMaxScale,
    speedMin: -22 / 3.6,
    speedMax: 22 / 3.6,
    dutyMin: base.dutyMin,
    dutyMax: base.dutyMax,
    wattMin: -500,
    wattMax: 500,
    inCurrentMin: base.inCurrentMin,
    inCurrentMax: base.inCurrentMax
  });
  saveProfiles();
}

function renderProfiles() {
  const profiles = [...state.profiles];
  if (state.activeProfile) {
    profiles.unshift(state.activeProfile);
  }

  els.profileList.innerHTML = profiles.map((profile, index) => {
    const realIndex = state.activeProfile && index === 0 ? -1 : state.activeProfile ? index - 1 : index;
    const panic = profile.name === "VESCOMETERPANIC" ? " panic" : "";
    const active = profile.isCurrent ? " active" : "";
    return `
      <article class="profile-card${panic}${active}">
        <span>${profile.isCurrent ? "Controller now" : "VESC profile"}</span>
        <strong>${escapeHtml(profile.name)}</strong>
        <small>${format(profile.speedMax * 3.6, 1)} km/h forward / ${format(Math.abs(profile.speedMin * 3.6), 1)} km/h reverse · ${format(profile.wattMax, 0)} W out</small>
        <div class="profile-actions">
          <button class="btn btn-outline" type="button" data-profile-action="reboot" data-profile-index="${realIndex}" ${profile.isCurrent ? "disabled" : ""}>Until Reboot</button>
          <button class="btn btn-red" type="button" data-profile-action="permanent" data-profile-index="${realIndex}" ${profile.isCurrent ? "disabled" : ""}>Use Permanently</button>
        </div>
      </article>
    `;
  }).join("");

  for (const button of els.profileList.querySelectorAll("[data-profile-action]")) {
    button.addEventListener("click", () => {
      const profile = state.profiles[Number(button.dataset.profileIndex)];
      if (profile) {
        applyProfile(profile, button.dataset.profileAction === "permanent");
      }
    });
  }
}

function trackSpeedTap() {
  const now = performance.now();
  state.tapTimes = state.tapTimes.filter((time) => now - time < 1300);
  state.tapTimes.push(now);
  if (state.tapTimes.length >= 5) {
    state.tapTimes.length = 0;
    triggerPanicShortcut();
  }
}

function triggerPanicShortcut() {
  const profile = state.profiles.find((item) => item.name === "VESCOMETERPANIC");
  if (!profile) {
    ensurePanicProfile();
  }
  const panic = state.profiles.find((item) => item.name === "VESCOMETERPANIC");
  if (panic) {
    applyProfile(panic, true, true);
    toggleProfiles(true);
    setText(els.profileState, "5-tap shortcut applied VESCOMETERPANIC permanently.");
  }
}

function requestPanicProfile(mode) {
  const profile = state.profiles.find((item) => item.name === "VESCOMETERPANIC");
  if (profile) {
    applyProfile(profile, mode === "permanently");
  }
}

function applyProfile(profile, permanent, skipConfirm = false) {
  if (!state.rx) {
    setText(els.profileState, "Connect VESC first.");
    return;
  }
  if (permanent && !skipConfirm && !confirm(`Use ${profile.name} permanently? This writes motor config to VESC flash.`)) {
    return;
  }
  sendMcconfTempSetup(profile, permanent);
  setText(els.profileState, `${profile.name} sent ${permanent ? "permanently" : "until reboot"}.`);
  setStatus("Profile", `${profile.name} active`, "demo");
  if (profile.name === "VESCOMETERPANIC") {
    document.body.classList.add("panic-shake");
    window.setTimeout(() => document.body.classList.remove("panic-shake"), 460);
  }
}

function sendMcconfTempSetup(profile, permanent) {
  const payload = [
    VESC.commSetMcconfTempSetup,
    permanent ? 1 : 0,
    1,
    1,
    0,
    ...float32AutoBytes(profile.currentMinScale),
    ...float32AutoBytes(profile.currentMaxScale),
    ...float32AutoBytes(profile.speedMin),
    ...float32AutoBytes(profile.speedMax),
    ...float32AutoBytes(profile.dutyMin),
    ...float32AutoBytes(profile.dutyMax),
    ...float32AutoBytes(profile.wattMin),
    ...float32AutoBytes(profile.wattMax)
  ];
  sendPayload(new Uint8Array(payload));
}

function setGateState(message) {
  if (els.gateState) {
    els.gateState.textContent = message;
  }
}

function toggleDemo() {
  if (state.demo) {
    stopDemo();
    setStatus("Offline", "Demo stopped", "offline");
    return;
  }

  if (state.device?.gatt?.connected) {
    state.device.gatt.disconnect();
  }

  state.demo = true;
  state.lastUpdate = 0;
  state.config = {
    ...state.config,
    motorPoles: 14,
    gearRatio: 1,
    wheelDiameter: 0.104,
    minVoltage: 36,
    maxVoltage: 50.4,
    batteryCutStart: 39,
    batteryCutEnd: 36,
    maxErpm: 52000,
    mcconf: true,
    appconf: true,
    mcconfTemp: true
  };
  renderConfig();
  setStatus("Demo", "Synthetic live values", "demo");
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

function renderConfig() {
  setText(els.configPoles, state.config.mcconfTemp ? `${state.config.motorPoles}` : "auto");
  setText(els.configGear, state.config.mcconfTemp ? `${format(state.config.gearRatio, 2)}:1` : "auto");
  setText(els.configWheel, state.config.mcconfTemp ? `${Math.round(state.config.wheelDiameter * 1000)} mm` : "auto");
  setText(els.configApp, state.config.appconf ? "read" : "pending");
  setText(els.configBattery, state.config.batteryCells ? `${state.config.batteryCells}s ${format(state.config.batteryAh, 1)}Ah` : "auto");
  setText(els.batteryRange, state.config.batteryCells ? `${state.config.batteryCells}s ${format(state.config.batteryAh, 1)}Ah from VESC` : state.config.mcconf ? `${format(state.config.minVoltage, 1)}-${format(state.config.maxVoltage, 1)} V from VESC` : "waiting for VESC limits");
}

function setStatus(label, detail, mode) {
  els.connectionState.textContent = label;
  els.connectionState.className = `state-pill ${mode}`;
  els.packetState.textContent = detail;
}

function readFloat32Auto(buffer, setIndex, index) {
  const res = (((buffer[index] << 24) >>> 0) | (buffer[index + 1] << 16) | (buffer[index + 2] << 8) | buffer[index + 3]) >>> 0;
  setIndex(index + 4);
  let e = (res >>> 23) & 255;
  const sigI = res & 0x7fffff;
  const neg = Boolean(res & 0x80000000);
  let sig = 0;
  if (e !== 0 || sigI !== 0) {
    sig = sigI / (8388608 * 2) + 0.5;
    e -= 126;
  }
  return (neg ? -sig : sig) * Math.pow(2, e);
}

function float32AutoBytes(number) {
  if (!Number.isFinite(number) || Math.abs(number) < 1.5e-38) {
    number = 0;
  }

  const neg = number < 0;
  const abs = Math.abs(number);
  let exponent = 0;
  let sig = 0;

  if (abs >= 1.5e-38) {
    exponent = Math.floor(Math.log2(abs)) + 1;
    const mantissa = abs / Math.pow(2, exponent);
    sig = Math.floor((mantissa - 0.5) * 2 * 8388608);
    exponent += 126;
  }

  let value = ((exponent & 255) << 23) | (sig & 0x7fffff);
  if (neg) {
    value |= 0x80000000;
  }
  value >>>= 0;
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255
  ];
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
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

function initHellCanvas() {
  const canvas = document.getElementById("hellbg");
  const ctx = canvas.getContext("2d");
  const embers = Array.from({ length: 28 }, () => makeEmber());

  const resize = () => {
    canvas.width = Math.floor(window.innerWidth * devicePixelRatio);
    canvas.height = Math.floor(window.innerHeight * devicePixelRatio);
  };

  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const ember of embers) {
      ember.y -= ember.speed;
      ember.x += Math.sin((ember.y + ember.phase) * 0.01) * 0.35;
      if (ember.y < -20) {
        Object.assign(ember, makeEmber(true));
      }
      ctx.beginPath();
      ctx.fillStyle = `rgba(192,57,43,${ember.alpha})`;
      ctx.arc(ember.x * devicePixelRatio, ember.y * devicePixelRatio, ember.size * devicePixelRatio, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(draw);
  };

  window.addEventListener("resize", resize);
  resize();
  draw();
}

function makeEmber(fromBottom = false) {
  return {
    x: Math.random() * window.innerWidth,
    y: fromBottom ? window.innerHeight + 20 : Math.random() * window.innerHeight,
    size: 0.8 + Math.random() * 1.8,
    speed: 0.12 + Math.random() * 0.45,
    alpha: 0.1 + Math.random() * 0.28,
    phase: Math.random() * 600
  };
}

if (!navigator.bluetooth) {
  setStatus("Offline", "Chrome/Edge with Web Bluetooth", "offline");
}
