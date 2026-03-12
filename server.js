/**
 * ActiveBharat — Dynamic Frontend Service
 * =========================================
 * Node.js + Express server that renders all pages server-side using EJS,
 * injects runtime configuration (API URLs, LAN IP), fetches live data from
 * the FastAPI backend before rendering, and proxies API + WebSocket traffic.
 *
 * Routes:
 *   GET /             → Landing page (index.ejs) — live athlete + session count
 *   GET /dashboard    → Biomechanics dashboard (dashboard.ejs) — injected WS URL
 *   GET /map          → Eklavya GPS Map (map.ejs) — injected backend base
 *
 *   GET /config.js    → Dynamic JS blob: window.AB_CONFIG = {...}
 *   GET /api/status   → Proxied health from FastAPI
 *   /api/*            → Transparent proxy to FastAPI (strips /api prefix)
 *   All other routes  → Transparent proxy (phone app connectivity)
 *   ws://.../ws/*     → WebSocket proxy to FastAPI
 *
 * How to run:
 *   cp .env.example .env
 *   npm install
 *   npm start
 */

'use strict';

require('dotenv').config();

const path   = require('path');
const http   = require('http');
const os     = require('os');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

// ── Config ─────────────────────────────────────────────────────────────────
const PROXY_PORT   = parseInt(process.env.PROXY_PORT   || '8083', 10);
const FASTAPI_PORT = parseInt(process.env.FASTAPI_PORT || '8082', 10);
const FASTAPI_HOST = process.env.FASTAPI_HOST || 'localhost';
const PC_IP        = process.env.PC_IP || getLanIP();
const FASTAPI_URL  = `http://${FASTAPI_HOST}:${FASTAPI_PORT}`;
const APP_ENV      = process.env.APP_ENV || 'development';

// ── LAN IP Detection ────────────────────────────────────────────────────────
function getLanIP() {
    const ifaces = os.networkInterfaces();
    let fallback = '127.0.0.1';
    for (const name of Object.keys(ifaces)) {
        if (/virtual|vbox|loopback|vmware|hyper/i.test(name)) continue;
        for (const iface of ifaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                if (iface.address.startsWith('172.17.') || iface.address.startsWith('192.168.')) {
                    return iface.address;
                }
                fallback = iface.address;
            }
        }
    }
    return fallback;
}

// ── Runtime Config Object (shared across all pages) ─────────────────────────
function buildConfig() {
    return {
        API_BASE:    `http://${PC_IP}:${PROXY_PORT}/api`,
        WS_BASE:     `ws://${FASTAPI_HOST}:${FASTAPI_PORT}`,
        PC_IP,
        PROXY_PORT,
        FASTAPI_PORT,
        APP_ENV,
    };
}

// ── Fetch live data from the backend (used at render time) ──────────────────
async function fetchBackendData(path, fallback = null) {
    try {
        const res = await fetch(`${FASTAPI_URL}${path}`, { signal: AbortSignal.timeout(2000) });
        if (!res.ok) return fallback;
        return await res.json();
    } catch {
        return fallback;
    }
}

// ── Express App ─────────────────────────────────────────────────────────────
const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static assets (CSS, client JS, images)
app.use('/public', express.static(path.join(__dirname, 'public')));

// ── CORS ────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
});

// ── Dynamic Config Script ────────────────────────────────────────────────────
// Browser pages load <script src="/config.js"> to get window.AB_CONFIG
app.get('/config.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(`window.AB_CONFIG = ${JSON.stringify(buildConfig(), null, 2)};`);
});

// ── Page Routes ─────────────────────────────────────────────────────────────

// Landing Page — fetches live stats before rendering
app.get('/', async (req, res) => {
    const [health, leaderboard] = await Promise.all([
        fetchBackendData('/health',     { status: 'offline', athlete_count: 0, active_sessions: 0 }),
        fetchBackendData('/leaderboard', { athletes: [] }),
    ]);

    res.render('index', {
        config: buildConfig(),
        backendOnline: health?.status === 'ok',
        athleteCount:  health?.athlete_count  ?? 0,
        activeSessions: health?.active_sessions ?? 0,
        topAthletes:   Array.isArray(leaderboard?.athletes) ? leaderboard.athletes.slice(0, 5) : [],
    });
});

// Biomechanics Dashboard
app.get('/dashboard', async (req, res) => {
    const health = await fetchBackendData('/health', { status: 'offline' });

    res.render('dashboard', {
        config: buildConfig(),
        backendOnline: health?.status === 'ok',
    });
});

// Eklavya GPS Map
app.get('/map', async (req, res) => {
    const health = await fetchBackendData('/health', { status: 'offline' });

    res.render('map', {
        config: buildConfig(),
        backendOnline: health?.status === 'ok',
    });
});

// ── API Routes ──────────────────────────────────────────────────────────────

// Convenience status endpoint for the frontend itself
app.get('/api/status', async (req, res) => {
    const health = await fetchBackendData('/health', null);
    res.json({
        frontend: 'ok',
        backend: health ? health.status : 'offline',
        config: buildConfig(),
        timestamp: new Date().toISOString(),
    });
});

// /api/* → FastAPI (strips /api prefix)
app.use('/api', createProxyMiddleware({
    target: FASTAPI_URL,
    changeOrigin: true,
    pathRewrite: { '^/api': '' },
    timeout: 20000,
    proxyTimeout: 20000,
    on: {
        error(err, req, res) {
            console.error('[API Proxy] error:', err.message);
            if (err.code === 'ECONNREFUSED') {
                res.status(503).json({ error: 'Backend offline', detail: 'Run: python api_server.py' });
            } else {
                res.status(502).json({ error: err.message });
            }
        },
        proxyReq(proxyReq, req) {
            console.log(`[API] ${req.method} ${req.path} → FastAPI`);
        },
    },
}));

// ── Phone App Transparent Proxy ──────────────────────────────────────────────
// Android app hits http://PC_IP:8083/session/start, /rppg/frame etc.
// Skip known page/static routes, proxy everything else straight to FastAPI.
const PAGE_ROUTES = ['/', '/dashboard', '/map', '/public', '/config.js', '/api'];

app.use('/', createProxyMiddleware({
    target: FASTAPI_URL,
    changeOrigin: true,
    timeout: 20000,
    proxyTimeout: 20000,
    filter(pathname) {
        return !PAGE_ROUTES.some(p => pathname === p || pathname.startsWith(p + '/'));
    },
    on: {
        error(err, req, res) {
            if (err.code === 'ECONNREFUSED') {
                res.status(503).json({ error: 'Backend offline', code: 503 });
            } else {
                res.status(502).json({ error: err.message, code: 502 });
            }
        },
        proxyReq(proxyReq, req) {
            console.log(`[Proxy] ${req.method} ${req.url} → FastAPI`);
        },
    },
}));

// ── HTTP + WebSocket Server ──────────────────────────────────────────────────
const server = http.createServer(app);

// WebSocket proxy: ws://PC_IP:8083/ws/* → ws://FastAPI
const wsProxy = createProxyMiddleware({
    target: `ws://${FASTAPI_HOST}:${FASTAPI_PORT}`,
    changeOrigin: true,
    ws: true,
    pathRewrite: { '^/ws': '' },
    on: { error(err) { console.error('[WS Proxy] error:', err.message); } },
});
server.on('upgrade', wsProxy.upgrade);

// ── Startup ──────────────────────────────────────────────────────────────────
server.listen(PROXY_PORT, '0.0.0.0', () => {
    const ip = PC_IP !== '0.0.0.0' ? PC_IP : getLanIP();
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  ActiveBharat — Frontend Service (Dynamic Node.js)      ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log(`║  Landing:    http://${ip}:${PROXY_PORT}/`);
    console.log(`║  Dashboard:  http://${ip}:${PROXY_PORT}/dashboard`);
    console.log(`║  Map:        http://${ip}:${PROXY_PORT}/map`);
    console.log(`║  API Status: http://${ip}:${PROXY_PORT}/api/status`);
    console.log(`║  WS Proxy:   ws://${ip}:${PROXY_PORT}/ws/*`);
    console.log(`║  Backend:    ${FASTAPI_URL}`);
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log('║  Make sure backend is running:                          ║');
    console.log('║  → cd ../activebharat-backend && python api_server.py   ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`[Server] Port ${PROXY_PORT} already in use.`);
    } else {
        console.error('[Server] Error:', err.message);
    }
    process.exit(1);
});
