import {
  buildReadScooter,
  buildReadBms,
  buildWriteScooter,
  parseFrames,
  interpretFrame,
  parseB0Payload,
  parseBms31,
  parseTrip3a,
  parseRange25,
} from "./protocol.js";
import {
  SHU_NRF_SERVICE,
  shuAssignNrfUartCharacteristics,
  shuRequestMtu251,
} from "./shu-serial-socket.js";

/**
 * BLE connect + „Auth“ exakt nach ScooterHackingUtility Plain-UART-Pfad:
 * - Service 6e400001… (g.u)
 * - g$e: welches Merkmal WRITE hat → TX zum Schreiben, das andere → Notify (g.j / g.k)
 * - g.o: MTU 251 wenn Web-API unterstützt
 * - g.p: Notifications auf Read/Notify-Char + CCCD (hier: startNotifications())
 *
 * Kein Mi (0xFE95), kein elliptischer Zweig (g$d).
 */

export class M365BleClient {
  constructor() {
    this.device = null;
    this.server = null;
    /** @type {BluetoothRemoteGATTCharacteristic|null} */
    this._writeCh = null;
    /** @type {BluetoothRemoteGATTCharacteristic|null} */
    this._notifyCh = null;
    this.buffer = new Uint8Array(0);
    this._listeners = new Set();
    this._pollTimer = null;
  }

  onTelemetry(cb) {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }

  _emit(state) {
    for (const fn of this._listeners) {
      try {
        fn(state);
      } catch (_) {}
    }
  }

  async connect() {
    if (!navigator.bluetooth) {
      throw new Error(
        "Web Bluetooth nicht verfügbar. Nutze Chrome/Edge (Desktop oder Android) und HTTPS oder localhost."
      );
    }

    this.device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [SHU_NRF_SERVICE] },
        { namePrefix: "MIScooter" },
        { namePrefix: "Ninebot" },
      ],
      optionalServices: [SHU_NRF_SERVICE],
    });

    this.device.addEventListener("gattserverdisconnected", () => {
      this._stopPoll();
      this._emit({ type: "disconnected" });
    });

    this.server = await this.device.gatt.connect();

    const nrf = await this.server.getPrimaryService(SHU_NRF_SERVICE);
    const { write, notify } = await shuAssignNrfUartCharacteristics(nrf);

    await shuRequestMtu251(this.server);

    this._writeCh = write;
    this._notifyCh = notify;

    await notify.startNotifications();
    notify.addEventListener("characteristicvaluechanged", (ev) =>
      this._onChunk(new Uint8Array(ev.target.value.buffer))
    );

    const state = {
      type: "connected",
      name: this.device.name,
      id: this.device.id,
      mode: "shu-nrf-uart",
    };
    this._emit(state);
    this._startPoll();
    return state;
  }

  disconnect() {
    this._stopPoll();
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this._writeCh = null;
    this._notifyCh = null;
  }

  async _write(buf) {
    const ch = this._writeCh;
    if (!ch) return;
    if (ch.properties.writeWithoutResponse) {
      await ch.writeValueWithoutResponse(buf);
    } else {
      await ch.writeValue(buf);
    }
  }

  _onChunk(chunk) {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;

    const { frames, consumed } = parseFrames(this.buffer);
    if (consumed > 0) {
      this.buffer = this.buffer.slice(consumed);
    }

    for (const frame of frames) {
      this._handleFrame(frame);
    }
  }

  _handleFrame(frame) {
    const info = interpretFrame(frame);
    if (!info) return;
    const { D, T, C, payload } = info;

    if (D === 0x23 && T === 0x01 && C === 0xb0) {
      const b0 = parseB0Payload(payload);
      if (b0) this._emit({ type: "b0", ...b0 });
    }
    if (D === 0x25 && T === 0x01 && C === 0x31) {
      const bms = parseBms31(payload);
      if (bms) this._emit({ type: "bms", ...bms });
    }
    if (D === 0x23 && T === 0x01 && C === 0x3a) {
      const trip = parseTrip3a(payload);
      if (trip) this._emit({ type: "trip", ...trip });
    }
    if (D === 0x23 && T === 0x01 && C === 0x25) {
      const r = parseRange25(payload);
      if (r) this._emit({ type: "range", ...r });
    }
  }

  _startPoll() {
    this._stopPoll();
    let tick = 0;
    this._pollTimer = setInterval(async () => {
      try {
        await this._write(buildReadScooter(0xb0, 0x20));
        await this._write(buildReadBms(0x31, 0x0a));
        if (tick % 2 === 0) {
          await this._write(buildReadScooter(0x25, 0x02));
          await this._write(buildReadScooter(0x3a, 0x04));
        }
        if (tick % 5 === 0) {
          await this._write(buildReadScooter(0x7c, 0x02));
          await this._write(buildReadScooter(0x7b, 0x02));
        }
        tick++;
      } catch (_) {}
    }, 280);
  }

  _stopPoll() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  async setCruise(on) {
    const v = on ? new Uint8Array([0x01, 0x00]) : new Uint8Array([0x00, 0x00]);
    await this._write(buildWriteScooter(0x7c, v));
  }

  async setRecoup(level) {
    const v = new Uint8Array([level & 0xff, 0x00]);
    await this._write(buildWriteScooter(0x7b, v));
  }

  async writeSpeedLimitU32(word20000, word10000) {
    const p = new Uint8Array(4);
    const dv = new DataView(p.buffer);
    dv.setUint16(0, word20000 & 0xffff, true);
    dv.setUint16(2, word10000 & 0xffff, true);
    await this._write(buildWriteScooter(0x73, p));
  }

  async readSpeedLimit() {
    await this._write(buildReadScooter(0x73, 0x04));
  }

  async applyEcoSportProfile(mode) {
    if (mode === "eco") {
      await this.setRecoup(1);
    } else if (mode === "sport") {
      await this.setRecoup(0);
    }
  }
}
