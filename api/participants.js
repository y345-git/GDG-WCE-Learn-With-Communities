// Vercel Serverless Function: /api/participants
// Serves the shared participants dataset in real-time

import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cache-Control', 's-maxage=1, stale-while-revalidate=5');

    if (req.method === 'OPTIONS') return res.status(200).end();

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
