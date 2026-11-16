/**
 * Convert model output into text that is safe to read aloud.
 * Code, HTML, URLs, tables and markup are intentionally removed before TTS.
 */
export function speakableText(raw: string) {
  let text = String(raw || "").replace(/```[\s\S]*?```/g, " ");
  const openFence = text.lastIndexOf("```");
  if (openFence >= 0 && (text.match(/```/g)?.length || 0) % 2 === 1) text = text.slice(0, openFence);
  text = text
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<html\b[\s\S]*?<\/html>/gi, " ")
    .replace(/<script\b[\s\S]*$/gi, " ")
    .replace(/<style\b[\s\S]*$/gi, " ")
    .replace(/<html\b[\s\S]*$/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/^[ \t]*\|.*$/gm, " ")
    .replace(/^[ \t]*[-:|\s]{3,}[ \t]*$/gm, " ")
    .replace(/^[ \t]{0,3}(?:[-*+]|\d+[.)])[ \t]+/gm, " ")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, " ")
    .replace(/[*_~#>|]/g, " ");
  return text.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
}

/**
 * Drain readable text without waiting for the full answer.
 * Complete sentences are emitted first; long fragments are cut at a soft
 * boundary near `maxChars`, then hard-cut only when no boundary exists.
 */
export function drainSpeechText(pending: string, maxChars = 120) {
  const limit = Math.max(12, Math.floor(maxChars));
  const chunks: string[] = [];
  let rest = pending;
  const push = (value: string) => {
    const clean = value.trim();
    if (clean.length >= 2) chunks.push(clean.length > 1200 ? clean.slice(0, 1200) : clean);
  };
  while (rest.length) {
    let terminator = -1;
    const scan = Math.min(rest.length, limit);
    for (let index = 0; index < scan; index++) {
      if (/[。！？!?；;\n]/.test(rest[index])) { terminator = index; break; }
    }
    if (terminator >= 0) {
      push(rest.slice(0, terminator + 1));
      rest = rest.slice(terminator + 1);
      continue;
    }
    if (rest.length < limit) break;
    let cut = -1;
    const floor = Math.floor(limit * 0.45);
    for (let index = limit - 1; index >= floor; index--) {
      if (/[，,、：:\s]/.test(rest[index])) { cut = index + 1; break; }
    }
    if (cut < 0) cut = limit;
    push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  return { chunks, rest };
}

/** Remove punctuation and whitespace so ASR output and spoken text can be compared. */
export function normalizeSpeechText(value: string) {
  return String(value || "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function diceCoefficient(left: string, right: string) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let index = 0; index < left.length - 1; index++) {
    const gram = left.slice(index, index + 2);
    grams.set(gram, (grams.get(gram) || 0) + 1);
  }
  let hits = 0;
  for (let index = 0; index < right.length - 1; index++) {
    const gram = right.slice(index, index + 2);
    const count = grams.get(gram) || 0;
    if (count > 0) { hits++; grams.set(gram, count - 1); }
  }
  return (2 * hits) / (left.length + right.length - 2);
}

/**
 * Detect ASR text that is actually the assistant's own TTS being picked up by
 * the microphone. Half-duplex capture is the primary defence; this is the
 * server-side safety net that stops an echo loop from starting a new turn.
 */
export function isLikelyEcho(transcript: string, spoken: string) {
  const heard = normalizeSpeechText(transcript);
  if (heard.length < 4) return false;
  const whole = normalizeSpeechText(spoken);
  if (whole.length >= 4 && whole.includes(heard)) return true;
  const sentences = String(spoken || "").split(/[。！？!?；;\n]+/).map(normalizeSpeechText).filter((sentence) => sentence.length >= 4);
  for (const sentence of sentences) {
    if (sentence.includes(heard) || heard.includes(sentence)) return true;
    if (diceCoefficient(heard, sentence) >= 0.7) return true;
  }
  return false;
}
