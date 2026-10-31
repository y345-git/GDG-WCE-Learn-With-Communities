// High-Performance Server with Centralized Real-Time Live Sync
// Serves static assets, serverless APIs, and runs server-side live synchronization

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import scrapeHandler from './api/scrape.js';
import batchScrapeHandler from './api/batch-scrape.js';

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

// Server-Side Continuous Background Live Scraper
async function runServerBackgroundSync() {
    console.log('[Server] Automated real-time background sync engine started.');

    while (true) {
        if (!isBackgroundSyncActive || participantsStore.length === 0) {
            await new Promise(r => setTimeout(r, 5000));
            continue;
        }

        // Prioritize active participants, then loop all
        const queue = [...participantsStore].sort((a, b) => (b.completedCount || 0) - (a.completedCount || 0));

        for (const p of queue) {
            if (!isBackgroundSyncActive) break;
            if (!p.profileUrl) continue;

            currentlySyncingId = p.id;

            try {
                // Mock request to internal scrapeHandler
                await new Promise((resolve) => {
                    const mockReq = { query: { url: p.profileUrl }, method: 'GET' };
                    const mockRes = {
                        setHeader: () => {},
                        status: (code) => ({
                            json: (data) => {
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
                            end: () => resolve()
                        })
                    };

                    scrapeHandler(mockReq, mockRes).catch(() => resolve());
                });
            } catch (err) {
                // Silent catch
            } finally {
                currentlySyncingId = null;
            }

            // Stagger by 120ms to keep network and CPU fluid
            await new Promise(r => setTimeout(r, 120));
        }

        // Rest 30s before next cycle
        await new Promise(r => setTimeout(r, 30000));
    }
}

// Start background worker
setTimeout(runServerBackgroundSync, 1000);

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

    // API: GET /api/participants (Returns real-time centralized state)
    if (pathname === '/api/participants') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            success: true,
            count: participantsStore.length,
            currentlySyncingId,
            participants: participantsStore,
            timestamp: new Date().toISOString()
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
