"use strict";

/**
 * Life is Verde — local scale bridge.
 *
 * Reads a weighing scale (OHAUS Navigator, Mettler-Toledo, A&D, or any generic
 * serial scale) over the OS serial port and rebroadcasts the weight on a local
 * WebSocket. The POS page connects to that socket via its "Scale bridge app"
 * driver — which works in ANY browser, including iPad/Safari where WebSerial
 * does not exist.
 *
 * Run:   npm install   (first time)   then   npm start
 * Config (optional env vars):
 *   WS_PORT      WebSocket port (default 8787)
 *   SERIAL_PATH  Force a COM port (e.g. COM3 / /dev/tty.usbserial-XXXX)
 *   SERIAL_BAUD  Force a baud rate (e.g. 2400); otherwise auto-detected
 *
 * Protocol sent to browsers (one JSON object per frame):
 *   {"type":"weight","grams":12.345,"stable":true}
 *   {"type":"status","state":"searching"|"connected"|"no-scale", ...}
 */

const { WebSocketServer } = require("ws");
const { SerialPort } = require("serialport");
const { parseSerialLine, makeStabilityTracker } = require("./parse");

const WS_PORT = Number(process.env.WS_PORT || 8787);
const FORCED_PATH = process.env.SERIAL_PATH || null;
const FORCED_BAUD = process.env.SERIAL_BAUD ? Number(process.env.SERIAL_BAUD) : null;
const BAUD_RATES = FORCED_BAUD ? [FORCED_BAUD] : [9600, 2400, 4800, 19200, 1200];
const PROBE_MS = 1500;
const RETRY_MS = 4000;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

// --- WebSocket server -------------------------------------------------------

const wss = new WebSocketServer({ host: "127.0.0.1", port: WS_PORT });
let lastStatus = { type: "status", state: "searching" };

function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      try {
        client.send(data);
      } catch {
        /* ignore a single bad client */
      }
    }
  }
}

function setStatus(status) {
  lastStatus = status;
  broadcast(status);
}

wss.on("listening", () =>
  log(`WebSocket listening on ws://localhost:${WS_PORT} — leave this window open.`),
);
wss.on("connection", (client) => {
  log("POS connected");
  try {
    client.send(JSON.stringify(lastStatus));
  } catch {
    /* ignore */
  }
});
wss.on("error", (err) => log("WebSocket error:", err.message));

// --- Serial detection + streaming ------------------------------------------

/** Rank ports so likely USB-serial scale adapters are tried first. */
function rankPorts(ports) {
  const score = (p) => {
    const s = `${p.manufacturer || ""} ${p.friendlyName || ""} ${p.pnpId || ""} ${p.vendorId || ""}`.toLowerCase();
    if (s.includes("ohaus")) return 0;
    if (/ftdi|prolific|ch340|ch341|silicon\s*labs|cp210|usb.?serial|0403|067b|10c4|1a86/.test(s)) return 1;
    return 2;
  };
  return ports
    .filter((p) => p.path)
    .sort((a, b) => score(a) - score(b));
}

/**
 * Open one port at one baud and wait briefly for a valid weight line. On
 * success the port is left OPEN and returned so streaming reuses the same
 * handle — closing and immediately reopening races the OS releasing the port
 * on Windows ("Opening COMx: Access denied"). Returns null (port closed) when
 * nothing valid arrives in time.
 */
function openAndDetect(path, baud) {
  return new Promise((resolve) => {
    let settled = false;
    let buffer = "";
    const port = new SerialPort({ path, baudRate: baud, autoOpen: false });

    const closeAnd = (value) => {
      try {
        port.close(() => resolve(value));
      } catch {
        resolve(value);
      }
    };
    const onData = (chunk) => {
      buffer += chunk.toString("latin1");
      const parts = buffer.split(/\r\n|\r|\n/);
      buffer = parts.pop() || "";
      for (const line of parts) {
        if (parseSerialLine(line)) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          port.removeListener("data", onData);
          // onError stays attached (settled-guarded no-op) so the port never
          // has zero 'error' listeners before startStreaming adds its own.
          resolve(port); // keep OPEN — handed straight to startStreaming
          return;
        }
      }
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      closeAnd(null);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      port.removeListener("data", onData);
      // Deliberately KEEP the error listener: an 'error' emitted while the
      // port is closing would otherwise have no listener and crash the
      // process. onError is settled-guarded, so it just swallows late errors.
      closeAnd(null);
    }, PROBE_MS);

    port.open((err) => {
      if (err) return onError();
      port.on("data", onData);
      port.on("error", onError);
    });
  });
}

/** Stream weight from an already-open port until it closes or errors. */
function startStreaming(port, path, baud) {
  const tracker = makeStabilityTracker();
  let buffer = "";
  setStatus({ type: "status", state: "connected", port: path, baud });
  log(`Streaming from ${path} @ ${baud} baud.`);

  port.on("data", (chunk) => {
    buffer += chunk.toString("latin1");
    const parts = buffer.split(/\r\n|\r|\n/);
    buffer = parts.pop() || "";
    for (const line of parts) {
      const reading = parseSerialLine(line);
      if (reading) {
        const r = tracker.push(reading);
        broadcast({ type: "weight", grams: r.grams, stable: r.stable });
      }
    }
  });
  port.on("close", () => {
    log("Serial port closed — re-detecting.");
    setStatus({ type: "status", state: "searching" });
    setTimeout(detectAndStream, RETRY_MS);
  });
  port.on("error", (err) => {
    log("Serial error:", err.message);
    try {
      port.close(() => {});
    } catch {
      /* ignore */
    }
  });
}

/** Find a scale across candidate ports/bauds, then stream. Retries forever. */
async function detectAndStream() {
  setStatus({ type: "status", state: "searching" });
  let ports = [];
  try {
    ports = FORCED_PATH ? [{ path: FORCED_PATH }] : rankPorts(await SerialPort.list());
  } catch (err) {
    log("Could not list serial ports:", err.message);
  }

  if (ports.length === 0) {
    log("No serial ports found. Plug in the scale (and its USB-serial adapter).");
    setStatus({ type: "status", state: "no-scale" });
    setTimeout(detectAndStream, RETRY_MS);
    return;
  }

  for (const p of ports) {
    for (const baud of BAUD_RATES) {
      log(`Probing ${p.path} @ ${baud}…`);
      // eslint-disable-next-line no-await-in-loop
      const port = await openAndDetect(p.path, baud);
      if (port) {
        log(`Scale found on ${p.path} @ ${baud}.`);
        startStreaming(port, p.path, baud);
        return;
      }
    }
  }

  log(
    "No scale data detected. Make sure the scale's Auto-Print is set to " +
      "Continuous (OHAUS: Print → A.Print → Cont). Retrying…",
  );
  setStatus({ type: "status", state: "no-scale" });
  setTimeout(detectAndStream, RETRY_MS);
}

process.on("SIGINT", () => {
  log("Shutting down.");
  process.exit(0);
});

log("Life is Verde scale bridge starting…");
detectAndStream();
