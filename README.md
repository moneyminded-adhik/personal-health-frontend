# ActiveBharat — Frontend Service

> **Dynamic Node.js + Express web application** that server-side-renders all pages using EJS, injects live runtime configuration, fetches live data from the Python backend, and proxies API + WebSocket traffic for the Android app.

---

## What Changed vs Static HTML

| Before | After |
|--------|-------|
| `dashboard.html` — staticfile, hardcoded IP | `views/dashboard.ejs` — API URL injected by Express at render time |
| `index.html` — mock athlete counts | `views/index.ejs` — **live** athlete count from FastAPI `/health` |
| `eklavya-map.html` — hardcoded backend host | `views/map.ejs` — `window.AB_CONFIG` set by `/config.js` dynamic endpoint |
| No backend status awareness | Backend `online/offline` banner rendered server-side |
| No navigation between pages | Sidebar navigation across all three views |

---

## Architecture

```
activebharat-frontend/
├── server.js            ← Express server: renders EJS, proxies API + WS
├── views/
│   ├── index.ejs        ← Landing page (live athlete count from FastAPI)
│   ├── dashboard.ejs    ← Biomechanics dashboard (WebSocket live metrics)
│   └── map.ejs          ← Eklavya GPS map (dynamic API_BASE via /config.js)
├── public/
│   └── css/
│       ├── index.css    ← Landing page styles
│       ├── dashboard.css← Dashboard styles
│       └── map.css      ← Map styles
├── package.json
├── Dockerfile
└── .env.example
```

### Dynamic Config Flow

```
Express (/config.js) → window.AB_CONFIG = { API_BASE, WS_BASE, PC_IP, ... }
                     ↓
Browser JS reads window.AB_CONFIG.API_BASE for all fetch() calls
                     ↓
No hardcoded IPs anywhere in the views or client JS
```

### Routes

| Route | Type | Description |
|-------|------|-------------|
| `GET /` | EJS render | Landing page with live stats |
| `GET /dashboard` | EJS render | Biomechanics dashboard |
| `GET /map` | EJS render | Eklavya GPS map |
| `GET /config.js` | Dynamic JS | `window.AB_CONFIG = {...}` blob |
| `GET /api/status` | JSON | Frontend + backend health |
| `/api/*` | Proxy | Strips `/api` prefix, forwards to FastAPI |
| All other `GET/POST` | Proxy | Transparent — for Android app |
| `ws://.../ws/*` | WS Proxy | Forwarded to FastAPI WebSocket |

---

## Setup

```bash
# 1. Clone
git clone https://github.com/your-org/activebharat-frontend.git
cd activebharat-frontend

# 2. Install
npm install

# 3. Configure
cp .env.example .env
# Edit .env: set PC_IP to your Wi-Fi IP (run ipconfig to find it)

# 4. Start
npm start
```

Then open:
- **Landing:** http://localhost:8083/
- **Dashboard:** http://localhost:8083/dashboard
- **Map:** http://localhost:8083/map
- **Status:** http://localhost:8083/api/status

### Docker

```bash
docker build -t activebharat-frontend .
docker run -p 8083:8083 --env PC_IP=192.168.x.x activebharat-frontend
```

---

## Development

```bash
npm run dev   # nodemon for hot-reload on file save
```

---

## Connecting the Other Repos

| Repo | Required? | How |
|------|-----------|-----|
| `activebharat-backend` | Yes | Set `FASTAPI_HOST=localhost FASTAPI_PORT=8082` in `.env` |
| `activebharat-android` | Optional | Android app hits `http://PC_IP:8083` — this server proxies to backend |

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `express` | Web server and routing |
| `ejs` | Server-side HTML templating |
| `http-proxy-middleware` | Transparent API + WebSocket proxy |
| `dotenv` | Environment variable loading |
| `node-fetch` | Fetch live data before rendering pages |
