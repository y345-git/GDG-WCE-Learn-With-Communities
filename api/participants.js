// Vercel Serverless Function: /api/participants
// Serves the shared participants dataset in real-time (Proxies from VPS if configured)

import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cache-Control', 's-maxage=1, stale-while-revalidate=5');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // 1. If VPS backend is configured, proxy live real-time sync data
    const vpsUrl = process.env.VPS_BACKEND_URL || process.env.SYNC_BACKEND_URL;
    if (vpsUrl) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3500); // 3.5s timeout
            const cleanUrl = vpsUrl.replace(/\/$/, '');
            const vpsRes = await fetch(`${cleanUrl}/api/participants`, {
                signal: controller.signal,
                headers: { 'Accept': 'application/json' }
            });
            clearTimeout(timeoutId);

            if (vpsRes.ok) {
                const data = await vpsRes.json();
                return res.status(200).json(data);
            }
        } catch (vpsErr) {
            console.warn('[Vercel API] VPS sync unreachable, falling back to static snapshot:', vpsErr.message);
        }
    }

    // 2. Fallback to local static JSON snapshot from repo
    try {
        const filePath = path.join(process.cwd(), 'public', 'data', 'participants.json');
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, error: 'Data not found' });
        }

        const data = fs.readFileSync(filePath, 'utf-8');
        const participants = JSON.parse(data);

        return res.status(200).json({
            success: true,
            count: participants.length,
            participants,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
}
