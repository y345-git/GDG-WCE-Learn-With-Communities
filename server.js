// High-Performance Server with Centralized Real-Time Live Sync
// Serves static assets, serverless APIs, and runs server-side live synchronization

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import scrapeHandler from './api/scrape.js';
import batchScrapeHandler from './api/batch-scrape.js';
import exportExcelHandler from './api/export-excel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

const DATA_FILE = path.join(__dirname, 'public', 'data', 'participants.json');
let participantsStore = [];
let isBackgroundSyncActive = true;
let currentlySyncingId = null;

// Load initial participants into central server store
try {
    if (fs.existsSync(DATA_FILE)) {
        participantsStore = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
        console.log(`[Server] Loaded ${participantsStore.length} participants into central store.`);
    }
} catch (e) {
    console.error('[Server] Error loading participants.json:', e);
}

// Save store to disk (throttled & atomic for Windows filesystem stability)
let saveTimer = null;
function saveStoreToDisk() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        try {
            const tempFile = `${DATA_FILE}.tmp`;
            fs.writeFileSync(tempFile, JSON.stringify(participantsStore, null, 2), 'utf-8');
            fs.renameSync(tempFile, DATA_FILE);
        } catch (e) {
            try {
                fs.writeFileSync(DATA_FILE, JSON.stringify(participantsStore, null, 2), 'utf-8');
            } catch (retryErr) {}
        }
    }, 4000);
}

// Server-Side Continuous Background Live Scraper (Parallel gentle workers)
const CONCURRENCY = parseInt(process.env.SYNC_CONCURRENCY || '3', 10);
let syncStats = {
    totalSynced: 0,
    cycleCount: 0,
    lastCycleStarted: new Date().toISOString(),
    lastCycleDurationSec: 0
};

async function scrapeSingleParticipant(p) {
    if (!p.profileUrl) return;
    currentlySyncingId = p.id;
    return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(), 7000); // 7s hard safety timeout

        const mockReq = { query: { url: p.profileUrl, force: 'true' }, method: 'GET' };
        const mockRes = {
            setHeader: () => {},
            status: () => ({
                json: (data) => {
                    clearTimeout(timeout);
                    if (data && data.success) {
                        const target = participantsStore.find(item => item.id === p.id);
                        if (target) {
                            target.completedCount = data.completedCount || 0;
                            target.completedBadges = data.completedBadges || [];
                            target.totalProfileBadges = data.totalBadgesOnProfile || target.completedCount;
                            target.extraBadges = data.extraBadges || [];
                            target.extraBadgesCount = data.extraBadgesCount || 0;
                            target.lastScrapedAt = data.scrapedAt || new Date().toISOString();
                            saveStoreToDisk();
                        }
                    }
                    resolve();
                },
                end: () => {
                    clearTimeout(timeout);
                    resolve();
                }
            })
        };

        scrapeHandler(mockReq, mockRes).catch(() => {
            clearTimeout(timeout);
            resolve();
        });
    });
}

async function runServerBackgroundSync() {
    console.log(`[Server] Automated real-time background sync engine started (Concurrency: ${CONCURRENCY}).`);

    while (true) {
        if (!isBackgroundSyncActive || participantsStore.length === 0) {
            await new Promise(r => setTimeout(r, 5000));
            continue;
        }

        const cycleStart = Date.now();
        syncStats.cycleCount++;
        syncStats.lastCycleStarted = new Date().toISOString();

        // Prioritize active participants, then loop all
        const queue = [...participantsStore].sort((a, b) => (b.completedCount || 0) - (a.completedCount || 0));

        let index = 0;
        async function worker() {
            while (index < queue.length && isBackgroundSyncActive) {
                const p = queue[index++];
                try {
                    await scrapeSingleParticipant(p);
                    syncStats.totalSynced++;
                } catch (e) {}
                await new Promise(r => setTimeout(r, 150));
            }
        }

        const workers = [];
        for (let w = 0; w < CONCURRENCY; w++) {
            workers.push(worker());
        }
        await Promise.all(workers);

        currentlySyncingId = null;
        syncStats.lastCycleDurationSec = Math.round((Date.now() - cycleStart) / 1000);
        console.log(`[Server] Completed sync cycle #${syncStats.cycleCount} in ${syncStats.lastCycleDurationSec}s (~${Math.round(syncStats.lastCycleDurationSec / 60)} min). Pausing 20s before next cycle...`);

        // Rest 20s before next cycle
        await new Promise(r => setTimeout(r, 20000));
    }
}

const IS_VERCEL = !!(process.env.VERCEL || process.env.NOW_REGION);
const VPS_URL = process.env.VPS_BACKEND_URL || process.env.SYNC_BACKEND_URL || 'http://62.84.172.73:3000';

// Start background worker (ONLY on standalone VPS / local server, NEVER in short-lived Vercel lambda)
if (!IS_VERCEL) {
    setTimeout(runServerBackgroundSync, 1000);
} else {
    console.log(`[Vercel Server] Running in cloud proxy mode -> Forwarding live sync to VPS at ${VPS_URL}`);
}

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;

    // Enable CORS for all routes
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        return res.end();
    }

    // API: GET /api/participants (Returns real-time centralized state from VPS or local store)
    if (pathname === '/api/participants') {
        // 1. If running on Vercel, proxy directly from the 24/7 PM2 VPS sync daemon!
        if (IS_VERCEL && VPS_URL) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 4500);
                const cleanUrl = VPS_URL.replace(/\/$/, '');
                const vpsRes = await fetch(`${cleanUrl}/api/participants?_t=${Date.now()}`, {
                    signal: controller.signal,
                    headers: { 'Accept': 'application/json' }
                });
                clearTimeout(timeoutId);

                if (vpsRes.ok) {
                    const data = await vpsRes.text();
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0'
                    });
                    return res.end(data);
                }
            } catch (err) {
                console.warn('[Vercel Server] VPS sync fetch failed, falling back to local store:', err.message);
            }
        }

        // 2. On VPS (or fallback on Vercel): Serve store with strict no-cache headers
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0'
        });
        return res.end(JSON.stringify({
            success: true,
            count: participantsStore.length,
            currentlySyncingId,
            participants: participantsStore,
            timestamp: new Date().toISOString()
        }));
    }

    // API: GET /api/health or /api/status (Health check & metrics for VPS and PM2)
    if (pathname === '/api/health' || pathname === '/api/status') {
        if (IS_VERCEL && VPS_URL) {
            try {
                const cleanUrl = VPS_URL.replace(/\/$/, '');
                const vpsRes = await fetch(`${cleanUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
                if (vpsRes.ok) {
                    const text = await vpsRes.text();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(text);
                }
            } catch (e) {}
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            status: 'healthy',
            service: 'GDG WCE Cloud Sync Service',
            uptimeSec: Math.round(process.uptime()),
            participantsCount: participantsStore.length,
            currentlySyncingId,
            syncStats,
            serverTime: new Date().toISOString()
        }));
    }

    // Helper to read JSON body
    const getBody = () => new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try { resolve(body ? JSON.parse(body) : {}); } catch (e) { resolve({}); }
        });
    });

    // API: /api/export-excel or /api/export (Secure Excel Export with Admin Key)
    if (pathname === '/api/export-excel' || pathname === '/api/export') {
        const mockReq = {
            url: req.url,
            method: req.method,
            headers: req.headers
        };
        const mockRes = {
            statusCode: 200,
            setHeader: (k, v) => res.setHeader(k, v),
            status: (code) => {
                res.statusCode = code;
                return {
                    json: (data) => {
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify(data));
                    },
                    send: (buf) => {
                        res.end(buf);
                    }
                };
            }
        };
        return exportExcelHandler(mockReq, mockRes);
    }

    // API: /api/scrape
    if (pathname === '/api/scrape') {
        req.query = Object.fromEntries(parsedUrl.searchParams);
        req.body = await getBody();
        return scrapeHandler(req, {
            setHeader: (k, v) => res.setHeader(k, v),
            status: (code) => ({
                json: (data) => {
                    // Update in central store
                    if (data && data.success && data.url) {
                        const target = participantsStore.find(item => item.profileUrl === data.url);
                        if (target) {
                            target.completedCount = data.completedCount || 0;
                            target.completedBadges = data.completedBadges || [];
                            target.totalProfileBadges = data.totalBadgesOnProfile || target.completedCount;
                            target.lastScrapedAt = data.scrapedAt || new Date().toISOString();
                            saveStoreToDisk();
                        }
                    }
                    res.writeHead(code, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(data));
                },
                end: () => {
                    res.writeHead(code);
                    res.end();
                }
            })
        });
    }

    // API: /api/batch-scrape
    if (pathname === '/api/batch-scrape') {
        req.query = Object.fromEntries(parsedUrl.searchParams);
        req.body = await getBody();
        return batchScrapeHandler(req, {
            setHeader: (k, v) => res.setHeader(k, v),
            status: (code) => ({
                json: (data) => {
                    res.writeHead(code, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(data));
                },
                end: () => {
                    res.writeHead(code);
                    res.end();
                }
            })
        });
    }

    // Static files from /public
    let relativePath = pathname === '/' ? '/index.html' : pathname;
    let filePath = path.join(__dirname, 'public', relativePath);

    if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('404 Not Found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    try {
        const content = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server Error: ' + err.message);
    }
});

server.listen(PORT, () => {
    console.log(`\n=============================================================`);
    console.log(` Google Developer Groups On Campus WCE - Cloud N Beyond`);
    console.log(` Centralized Real-Time Webapp`);
    console.log(` Running locally at: http://localhost:${PORT}`);
    console.log(`=============================================================\n`);
});
