// Vercel Serverless Function: /api/batch-scrape
// Scrapes up to 5 profiles concurrently in a single invocation for fast background sync

import scrapeHandler from './scrape.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const urls = req.body && req.body.urls ? req.body.urls : [];
    if (!Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({ success: false, error: 'Expected { urls: [...] } array' });
    }

    // Limit to max 5 per batch for Vercel Hobby timeout safety
    const batch = urls.slice(0, 5);

    const promises = batch.map(async (item) => {
        const url = typeof item === 'string' ? item : item.url;
        const id = typeof item === 'object' ? item.id : null;

        // Mock req/res for internal scrapeHandler call
        return new Promise((resolve) => {
            const mockReq = { query: { url }, method: 'GET' };
            const mockRes = {
                setHeader: () => {},
                status: (code) => ({
                    json: (data) => resolve({ id, url, statusCode: code, ...data }),
                    end: () => resolve({ id, url, statusCode: code })
                })
            };
            scrapeHandler(mockReq, mockRes).catch(err => {
                resolve({ id, url, success: false, error: err.message });
            });
        });
    });

    const results = await Promise.all(promises);

    return res.status(200).json({
        success: true,
        count: results.length,
        results
    });
}
