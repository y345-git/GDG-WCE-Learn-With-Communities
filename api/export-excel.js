// Vercel Serverless Function: /api/export-excel
// Generates and downloads secure Excel report with admin key authentication

import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const ADMIN_KEY = process.env.EXPORT_SECRET_KEY || process.env.ADMIN_SECRET_KEY || 'gdg-wce-admin-2026';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const key = parsedUrl.searchParams.get('key') || 
                parsedUrl.searchParams.get('token') || 
                parsedUrl.searchParams.get('secret') || 
                req.headers['x-admin-key'];
    const authHeader = req.headers['authorization'];
    const bearer = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';

    if (key !== ADMIN_KEY && bearer !== ADMIN_KEY) {
        return res.status(403).json({
            error: 'Forbidden',
            message: 'Access denied: Valid secret admin key is required to export participant data. Usage: /api/export-excel?key=<ADMIN_SECRET_KEY>'
        });
    }

    try {
        let participants = [];
        const vpsUrl = process.env.VPS_BACKEND_URL || process.env.SYNC_BACKEND_URL || 'http://62.84.172.73:3000';

        // 1. Fetch live data from VPS if reachable
        if (vpsUrl) {
            try {
                const vpsRes = await fetch(`${vpsUrl.replace(/\/$/, '')}/api/participants?_t=${Date.now()}`, {
                    signal: AbortSignal.timeout(4000),
                    headers: { 'Accept': 'application/json' }
                });
                if (vpsRes.ok) {
                    const data = await vpsRes.json();
                    if (data && Array.isArray(data.participants) && data.participants.length > 0) {
                        participants = data.participants;
                    }
                }
            } catch (e) {}
        }

        // 2. Fallback to local snapshot
        if (!participants || participants.length === 0) {
            const filePath = path.join(process.cwd(), 'public', 'data', 'participants.json');
            if (fs.existsSync(filePath)) {
                participants = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            }
        }

        // 3. Load syllabus target badges
        let targetBadges = [];
        const badgesPath = path.join(process.cwd(), 'public', 'data', 'badges.json');
        if (fs.existsSync(badgesPath)) {
            targetBadges = JSON.parse(fs.readFileSync(badgesPath, 'utf-8'));
        }

        // Sort by rank: highest completed count first
        participants.sort((a, b) => (b.completedCount || 0) - (a.completedCount || 0));

        // Sheet 1: Swag Rewards and live progress
        const rows = participants.map((p, idx) => {
            const count = p.completedCount || 0;
            let stage = 'None';
            let reward = 'Needs 5 for Bottle';
            if (count >= 10) {
                stage = 'Stage 2';
                reward = 'Official T-Shirt';
            } else if (count >= 5) {
                stage = 'Stage 1';
                reward = 'Water Bottle';
            } else if (count >= 1) {
                stage = 'In Progress';
                reward = `Needs ${5 - count} for Bottle`;
            }

            return {
                "Rank": idx + 1,
                "User Name": p.name || '',
                "User Email": p.email || '',
                "Google Skills Profile URL": p.profileUrl || '',
                "Swag Reward": reward,
                "Swag Stage": stage,
                "Live Completed Badges Count": count,
                "Completed Badges List": (p.completedBadges || []).map(b => b.name).join('; '),
                "Total Profile Badges": p.totalProfileBadges || count,
                "Access Code": p.accessCode || '',
                "Last Verified At": p.lastScrapedAt || 'Initial Snapshot'
            };
        });

        // Sheet 2: 10 Target Badges Breakdown
        const badgeRows = targetBadges.map(b => {
            const norm = (b.normalizedName || b.name || '').toLowerCase();
            let done = 0;
            for (const p of participants) {
                if (p.completedBadges && p.completedBadges.some(cb => (cb.normalizedName || cb.name || '').toLowerCase() === norm)) {
                    done++;
                }
            }
            return {
                "#": b.order || 0,
                "Badge Name": b.name,
                "Course URL": b.url || '',
                "Required Credits": b.credits || 0,
                "Students Completed": done,
                "Completion Percentage": `${Math.round((done / (participants.length || 1)) * 100)}%`
            };
        });

        const wb = XLSX.utils.book_new();
        const ws1 = XLSX.utils.json_to_sheet(rows);
        const ws2 = XLSX.utils.json_to_sheet(badgeRows);
        XLSX.utils.book_append_sheet(wb, ws1, "Swag Rewards - WCE 2026");
        XLSX.utils.book_append_sheet(wb, ws2, "10 Badges Track Summary");

        const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        const dateStr = new Date().toISOString().slice(0, 10);
        const filename = `Google_Cloud_Learn_With_Communities_2026_WCE_${dateStr}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        return res.status(200).send(excelBuffer);

    } catch (err) {
        return res.status(500).json({ error: 'Failed to generate Excel report', details: err.message });
    }
}
