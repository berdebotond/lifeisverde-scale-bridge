"use strict";

/**
 * Scale line parser + stability tracker for the bridge.
 *
 * This intentionally MIRRORS lib/pos/scale/parsers.ts and lib/pos/scale/
 * stability.ts in the web app (kept in plain CommonJS so the bridge has no build
 * step). If you change the parsing rules in one place, change both.
 */

const UNIT_TO_GRAMS = {
  g: 1,
  kg: 1000,
  mg: 0.001,
  oz: 28.349523125,
  lb: 453.59237,
  ct: 0.2,
};

function roundGrams(g) {
  return Math.round(g * 1000) / 1000;
}

/** Parse one ASCII scale line → {grams, stable} or null. Tolerant of many models. */
function parseSerialLine(line) {
  if (typeof line !== "string") return null;
  const raw = line.replace(/[\u0000-\u001f]+/g, " ").trim();
  if (raw === "") return null;

  let stable = false;
  const status = /(^|[\s,])(ST|US|OL)([\s,]|$)/i.exec(raw);
  if (status) stable = status[2].toUpperCase() === "ST";
  if (/\?/.test(raw)) stable = false;

  let sign = 1;
  let numText;
  let unit = "g";

  const unitMatch =
    /([+-])?\s*([0-9]+(?:[.,][0-9]+)?)\s*(kg|mg|g|oz|lb|ct)\b/i.exec(raw);
  if (unitMatch) {
    sign = unitMatch[1] === "-" ? -1 : 1;
    numText = unitMatch[2];
    unit = unitMatch[3].toLowerCase();
  } else {
    const bare = raw
      .replace(/(^|[\s,])(ST|US|OL)([\s,]|$)/gi, " ")
      .replace(/\?/g, "")
      .trim();
    const bareMatch = /^([+-])?\s*([0-9]+(?:[.,][0-9]+)?)$/.exec(bare);
    if (!bareMatch) return null;
    sign = bareMatch[1] === "-" ? -1 : 1;
    numText = bareMatch[2];
  }

  const value = Number.parseFloat(numText.replace(",", "."));
  if (!Number.isFinite(value)) return null;
  const grams = sign * value * (UNIT_TO_GRAMS[unit] ?? 1);
  if (!Number.isFinite(grams)) return null;
  return { grams: roundGrams(grams), stable };
}

/** Derive stability from a converged window when the scale doesn't flag it. */
function makeStabilityTracker(window = 4, epsilonG = 0.005) {
  const recent = [];
  return {
    push(r) {
      recent.push(r.grams);
      if (recent.length > window) recent.shift();
      if (r.stable) return r;
      if (recent.length < window) return r;
      const min = Math.min(...recent);
      const max = Math.max(...recent);
      return max - min <= epsilonG ? { grams: r.grams, stable: true } : r;
    },
  };
}

module.exports = { parseSerialLine, makeStabilityTracker };
