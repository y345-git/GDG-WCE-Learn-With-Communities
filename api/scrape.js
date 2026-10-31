// Vercel Serverless Function: /api/scrape
// Scrapes a single Google Skills public profile and matches against the 10 target badges

const TARGET_BADGES = [
    { name: "The Basics of Google Cloud Compute", normalized: "the basics of google cloud compute", order: 1, credits: 4 },
    { name: "Configure Service Accounts and IAM Roles for Google Cloud", normalized: "configure service accounts and iam roles for google cloud", order: 2, credits: 4 },
    { name: "Implement Speech and Language Solutions with Pre-trained APIs", normalized: "implement speech and language solutions with pre-trained apis", order: 3, credits: 4 },
    { name: "Develop AI-Powered Prototypes in Google AI Studio", normalized: "develop ai-powered prototypes in google ai studio", order: 4, credits: 0 },
    { name: "Analyze Images with the Cloud Vision API", normalized: "analyze images with the cloud vision api", order: 5, credits: 12 },
    { name: "Build a Website on Google Cloud", normalized: "build a website on google cloud", order: 6, credits: 13 },
    { name: "Create Your First Gemini Enterprise Application", normalized: "create your first gemini enterprise application", order: 7, credits: 0 },
    { name: "Store, Process, and Manage Data on Google Cloud - Console", normalized: "store, process, and manage data on google cloud - console", order: 8, credits: 3 },
    { name: "Using the Google Cloud Speech API", normalized: "using the google cloud speech api", order: 9, credits: 4 },
    { name: "Explore Generative AI in Agent Platform", normalized: "explore generative ai in agent platform", order: 10, credits: 16 }
];

const TARGET_MAP = new Map(TARGET_BADGES.map(b => [b.normalized, b]));

function normalizeTitle(t) {
    if (!t) return '';
    return t.replace(/\xa0/g, ' ')
            .replace(/[’']/g, "'")
            .replace(/[“”"]/g, '"')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
}

function calculateMilestone(count) {
    if (count >= 10) return 'Milestone 3';
    if (count >= 5) return 'Milestone 2';
    if (count >= 3) return 'Milestone 1';
    return 'No Milestone';
}

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const url = req.query.url || (req.body && req.body.url);
    if (!url || !url.startsWith('http')) {
        return res.status(400).json({ success: false, error: 'Missing or invalid profile url parameter' });
    }

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9'
            },
            signal: AbortSignal.timeout(8000)
        });

        if (!response.ok) {
            return res.status(response.status).json({
                success: false,
                error: `HTTP ${response.status} from skills.google`
            });
        }

        const html = await response.text();

        // Extract badges
        const badgeRegex = /<div class=['"]profile-badge['"]>([\s\S]*?)<\/div>/g;
        let match;
        const completedBadges = {};
        const extraBadges = [];
        let totalBadgesOnProfile = 0;

        while ((match = badgeRegex.exec(html)) !== null) {
            totalBadgesOnProfile++;
            const block = match[1];
            const titleMatch = block.match(/<span class=['"]ql-title-medium[^'"]*['"]>\s*([\s\S]*?)\s*<\/span>/);
            const dateMatch = block.match(/<span class=['"]ql-body-medium[^'"]*['"]>\s*([\s\S]*?)\s*<\/span>/);
            const imgMatch = block.match(/<img[^>]*src=['"]([^'"]+)['"]/);
            const linkMatch = block.match(/<a class=['"]badge-image['"][^>]*href=['"]([^'"]+)['"]/);

            if (!titleMatch) continue;

            const rawTitle = titleMatch[1].trim();
            const dateStr = dateMatch ? dateMatch[1].trim() : '';
            const imgSrc = imgMatch ? imgMatch[1] : '';
            const badgeHref = linkMatch ? linkMatch[1] : '';
            const norm = normalizeTitle(rawTitle);

            if (TARGET_MAP.has(norm)) {
                const targetObj = TARGET_MAP.get(norm);
                completedBadges[norm] = {
                    name: targetObj.name,
                    normalizedName: norm,
                    order: targetObj.order,
                    earnedDate: dateStr,
                    imageUrl: imgSrc,
                    badgeUrl: badgeHref
                };
            } else {
                extraBadges.push({
                    name: rawTitle,
                    earnedDate: dateStr,
                    imageUrl: imgSrc,
                    badgeUrl: badgeHref
                });
            }
        }

        const completedCount = Object.keys(completedBadges).length;
        const milestone = calculateMilestone(completedCount);

        return res.status(200).json({
            success: true,
            url,
            completedCount,
            milestone,
            totalBadgesOnProfile,
            completedBadges: Object.values(completedBadges),
            extraBadgesCount: extraBadges.length,
            extraBadges,
            scrapedAt: new Date().toISOString()
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            url,
            error: err.message || 'Scrape failed'
        });
    }
}
