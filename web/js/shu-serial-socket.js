/**
 * UUIDs and Nordic UART role resolution from decompiled ScooterHackingUtility:
 * Lsh/cfw/utility/services/g; <clinit> + Lsh/cfw/utility/services/g$e;->b()
 *
 * Plain serial path (no 0xFE95 Mi service) — used for current NRF-only scooters.
 */

/** CCCD — g.t */
export const SHU_DESC_CCCD = "00002902-0000-1000-8000-00805f9b34fb";

/** Nordic UART service — g.u */
export const SHU_NRF_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";

/** g.v — SHU resolves write vs notify by characteristic properties (g$e) */
export const SHU_NRF_CHAR_A = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";

/** g.w */
export const SHU_NRF_CHAR_B = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

/**
 * Mirrors g$e.b( nordicService, _ ): pick write characteristic (k) and notify (j).
 * @returns {{ write: BluetoothRemoteGATTCharacteristic, notify: BluetoothRemoteGATTCharacteristic }}
 */
export async function shuAssignNrfUartCharacteristics(service) {
  const a = await service.getCharacteristic(SHU_NRF_CHAR_A);
  const b = await service.getCharacteristic(SHU_NRF_CHAR_B);

  const wA = hasShuWrite(a.properties);
  const wB = hasShuWrite(b.properties);

  if (wA && wB) {
    throw new Error(
      "multiple write characteristics (SHU g$e) — beide Merkmale schreibbar"
    );
  }
  if (wA) {
    return { write: a, notify: b };
  }
  if (wB) {
    return { write: b, notify: a };
  }
  throw new Error("no write characteristic (SHU g$e)");
}

/** Android PROPERTY_WRITE_NO_RESPONSE = 0x4; PROPERTY_WRITE = 0x8 — accept both */
function hasShuWrite(prop) {
  return !!(prop && (prop.write || prop.writeWithoutResponse));
}

/**
 * g.o: requestMtu(0xFB) — 251 bytes
 * @param {BluetoothRemoteGATTServer} server
 */
export async function shuRequestMtu251(server) {
  const req = server.requestMtu;
  if (typeof req === "function") {
    try {
      await req.call(server, 251);
    } catch (_) {}
  }
}
