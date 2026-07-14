# Life is Verde — Scale Bridge

A tiny program that runs on the point-of-sale computer, reads your weighing
scale over its serial/USB port, and sends the weight to the Life is Verde POS
over a local WebSocket.

**Why use it instead of connecting the scale directly in the browser?**

- Works in **any** browser, including **iPad/Safari** (the built-in "Serial
  scale" option only works in Chrome/Edge on desktop).
- No per-device permission prompt.
- Handles scale quirks (baud rate, print format) natively — reliable for
  **OHAUS Navigator**, Mettler-Toledo, A&D, Sartorius and generic serial scales.

---

## 1. Install (once)

1. Install **Node.js LTS** from <https://nodejs.org> (Windows/Mac/Linux).
2. Put this `scale-bridge` folder on the POS computer.

## 2. Run

- **Windows:** double-click **`start.bat`**. The first run installs
  dependencies automatically; leave the window open.
- **Mac/Linux / manual:**
  ```bash
  cd scale-bridge
  npm install      # first time only
  npm start
  ```

You should see:

```
WebSocket listening on ws://localhost:8787 — leave this window open.
Probing COM3 @ 9600…
Scale found on COM3 @ 2400.
Streaming from COM3 @ 2400 baud.
```

## 3. Point the POS at it

In the POS: **Punto de venta → Conectar báscula → App puente de báscula**.
The default address `ws://localhost:8787` matches this bridge, so it just
connects. (Use **Configurar puente…** only if you changed the port or run the
bridge on another machine — see "iPad / another device" below.)

---

## Scale setup (important)

The bridge auto-detects the **port and baud rate**, but the scale must be set to
**stream continuously**. On an **OHAUS Navigator**:

- **Print → A.Print → Cont** (auto-print continuous). "On stable" also works.
- Baud/parity: leave at defaults — the bridge tries 9600, 2400, 4800, 19200,
  1200 automatically.

Connect the scale by its **RS-232 port through a USB-to-serial adapter**, or its
USB port if it presents as a COM port.

---

## Options (environment variables)

| Variable      | Default        | Purpose                                  |
| ------------- | -------------- | ---------------------------------------- |
| `WS_PORT`     | `8787`         | WebSocket port to serve on.              |
| `SERIAL_PATH` | *(auto)*       | Force a port, e.g. `COM3` or `/dev/tty…` |
| `SERIAL_BAUD` | *(auto-probe)* | Force a baud rate, e.g. `2400`.          |

Example (Windows): `set SERIAL_PATH=COM3 && set SERIAL_BAUD=2400 && npm start`

---

## iPad / running on another device

A browser on the **HTTPS** POS site can only open `ws://localhost` (treated as
secure). It **cannot** open `ws://<some-LAN-IP>` — browsers block that as mixed
content. So:

- **Recommended:** run the POS on a **Windows touch PC / mini-PC** with the scale
  and this bridge on the **same** device → `ws://localhost:8787` works everywhere.
- **True iPad (scale on a separate PC):** the bridge must be served over
  **`wss://` with a trusted TLS certificate**, and you point **Configurar puente…**
  at `wss://<host>:8787`. This requires a certificate the iPad trusts; ask us to
  help set this up.

---

## Troubleshooting

- **"No serial ports found"** — plug in the scale/adapter; install the adapter's
  driver (FTDI/Prolific/CH340/CP210x).
- **Connects but no weight** — the scale isn't streaming. Set Auto-Print to
  Continuous (see *Scale setup*).
- **Wrong/garbled number** — tell us the exact line your scale prints; the parser
  is easy to extend. You can see raw behavior by forcing a baud with `SERIAL_BAUD`.
- **Port already in use** — another program (or a second bridge window) holds the
  COM port. Close it.
