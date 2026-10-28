import { describe, expect, it } from "vitest";
import { NATIVE_FRAME_MAX_BYTES } from "../src/native-framing.js";
import {
  createNativeInputPump,
  feedNativeInputPump,
} from "../src/native-input-pump.js";

function encodeEnvelope(value: unknown): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(value));
  const out = new Uint8Array(4 + json.byteLength);
  new DataView(out.buffer).setUint32(0, json.byteLength, true);
  out.set(json, 4);
  return out;
}

describe("native stdin pump", () => {
  it("drops an oversized declared length without holding the payload in the buffer", () => {
    const pump = createNativeInputPump();
    const oversizePayloadBytes = NATIVE_FRAME_MAX_BYTES + 1;
    const header = Buffer.alloc(4);
    header.writeUInt32LE(oversizePayloadBytes, 0);
    feedNativeInputPump(pump, header);
    expect(pump.discardPayloadBytes).toBe(oversizePayloadBytes);
    expect(pump.buffer.length).toBe(0);

    let maxBuffered = pump.buffer.length;
    let remaining = oversizePayloadBytes;
    while (remaining > 0) {
      const chunkSize = Math.min(remaining, 256);
      feedNativeInputPump(pump, Buffer.alloc(chunkSize, 0x61));
      remaining -= chunkSize;
      maxBuffered = Math.max(maxBuffered, pump.buffer.length);
    }
    expect(pump.discardPayloadBytes).toBe(0);
    expect(maxBuffered).toBeLessThan(512);

    const valid = encodeEnvelope({
      protocol: "v1",
      type: "runtime.status",
      requestId: "1",
      timestamp: 0,
      metadata: {},
    });
    const frames = feedNativeInputPump(pump, Buffer.from(valid));
    expect(frames).toHaveLength(1);
    expect(pump.buffer.length).toBe(0);
  });
});
