// Local development server for testing Vercel API and static frontend locally
// Zero dependencies needed - uses native Node.js HTTP and ESM

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import scrapeHandler from './api/scrape.js';
import batchScrapeHandler from './api/batch-scrape.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

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

    // Helper to read JSON body
    const getBody = () => new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                resolve({});
            }
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

    // If file doesn't exist in public, check root or return 404
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
    console.log(` Google Developer Groups On Campus WCE - Cloud Workshop Tracker`);
    console.log(` Vercel-Ready JavaScript Webapp`);
    console.log(` Running locally at: http://localhost:${PORT}`);
    console.log(`=============================================================\n`);
});
