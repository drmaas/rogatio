import { Buffer } from "node:buffer";
import { NATIVE_FRAME_MAX_BYTES } from "./native-framing.js";

export interface NativeInputPumpState {
  buffer: Buffer;
  discardPayloadBytes: number;
}

export function createNativeInputPump(): NativeInputPumpState {
  return {
    buffer: Buffer.alloc(0),
    discardPayloadBytes: 0,
  };
}

/** Extract complete length-prefixed native frames from buffered stdin bytes. */
export function feedNativeInputPump(
  state: NativeInputPumpState,
  chunk: Buffer,
): Uint8Array[] {
  state.buffer = Buffer.concat([state.buffer, chunk]);
  const frames: Uint8Array[] = [];
  for (;;) {
    if (state.discardPayloadBytes > 0) {
      if (state.buffer.length === 0) break;
      const skip = Math.min(state.buffer.length, state.discardPayloadBytes);
      state.buffer = state.buffer.subarray(skip);
      state.discardPayloadBytes -= skip;
      continue;
    }
    if (state.buffer.length < 4) break;
    const length = state.buffer.readUInt32LE(0);
    if (length > NATIVE_FRAME_MAX_BYTES) {
      state.buffer = state.buffer.subarray(4);
      state.discardPayloadBytes = length;
      continue;
    }
    if (state.buffer.length < 4 + length) break;
    frames.push(
      Buffer.from(state.buffer.subarray(0, 4 + length)) as Uint8Array,
    );
    state.buffer = state.buffer.subarray(4 + length);
  }
  return frames;
}
