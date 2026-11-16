import { test } from "node:test";
import assert from "node:assert/strict";
import { encodePcmWav, browserAudioToWav } from "../src/audio.js";

test("browser audio encoder produces bounded 16 kHz mono PCM without a local process", async () => {
  const samples = new Float32Array([-2, -1, 0, 0.5, 1, 2, Number.NaN]);
  const wav = encodePcmWav(samples);
  const view = new DataView(wav.buffer);
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), "RIFF");
  assert.equal(view.getUint32(4, true), wav.length - 8);
  assert.equal(view.getUint16(22, true), 1); assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(34, true), 16);
  assert.deepEqual(Array.from(samples, (_, index) => view.getInt16(44 + index * 2, true)), [-32768, -32768, 0, 16384, 32767, 32767, 0]);
  assert.throws(() => encodePcmWav(new Float32Array()), /65 秒/);
  assert.throws(() => encodePcmWav(new Float32Array(16000 * 66)), /65 秒/);
  assert.throws(() => encodePcmWav(samples, 48000), /16 kHz/);
  await assert.rejects(browserAudioToWav(new Blob()), /为空/);
  await assert.rejects(browserAudioToWav(new Blob(["audio"]), AbortSignal.abort()), /abort/i);
});
