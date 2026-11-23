import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import scrapeHandler from '../api/scrape.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', 'public', 'data', 'participants.json');

const args = process.argv.slice(2);
if (args.length < 3) {
    console.log(`
Usage:
  node scripts/add-participant.js "<Full Name>" "<Email>" "<Google Skills Public Profile URL>"

Example:
  node scripts/add-participant.js "Rahul Sharma" "rahul@gmail.com" "https://www.skills.google/public_profiles/xxxx-xxxx"
`);
    process.exit(1);
}

const [name, email, profileUrl] = args.map(a => a.trim());

// Validation
if (!name) {
    console.error('Error: Name cannot be empty.');
    process.exit(1);
}
if (!email || !email.includes('@')) {
    console.error('Error: Invalid email format.');
    process.exit(1);
}
if (!profileUrl || !profileUrl.startsWith('http')) {
    console.error('Error: Profile URL must be a valid HTTP/HTTPS URL.');
    process.exit(1);
}

// Load current participants
if (!fs.existsSync(DATA_FILE)) {
    console.error(`Error: Could not find ${DATA_FILE}`);
    process.exit(1);
}

const participants = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));

// Check for duplicates
const existingByEmail = participants.find(p => p.email && p.email.toLowerCase() === email.toLowerCase());
if (existingByEmail) {
    console.warn(`Warning: A participant with email ${email} already exists (ID: ${existingByEmail.id}, Name: ${existingByEmail.name}).`);
}

const existingByUrl = participants.find(p => p.profileUrl && p.profileUrl.toLowerCase() === profileUrl.toLowerCase());
if (existingByUrl) {
    console.warn(`Warning: A participant with this profile URL already exists (ID: ${existingByUrl.id}, Name: ${existingByUrl.name}).`);
}

// Generate new unique ID
const maxId = participants.reduce((max, p) => Math.max(max, p.id || 0), 0);
const newId = maxId + 1;

console.log(`\nAdding new participant:`);
console.log(`  ID: ${newId}`);
console.log(`  Name: ${name}`);
console.log(`  Email: ${email}`);
console.log(`  Profile URL: ${profileUrl}`);
console.log(`\nFetching initial badges from Google Cloud Skills...`);

// Initial scrape
let scrapeData = {
    completedCount: 0,
    completedBadges: [],
    totalProfileBadges: 0,
    extraBadges: [],
    extraBadgesCount: 0,
    scrapedAt: new Date().toISOString()
};

try {
    await new Promise((resolve) => {
        const mockReq = { query: { url: profileUrl, force: 'true' }, method: 'GET' };
        const mockRes = {
            setHeader: () => {},
            status: () => ({
                json: (data) => {
                    if (data && data.success) {
                        scrapeData = {
                            completedCount: data.completedCount || 0,
                            completedBadges: data.completedBadges || [],
                            totalProfileBadges: data.totalBadgesOnProfile || (data.completedCount || 0),
                            extraBadges: data.extraBadges || [],
                            extraBadgesCount: data.extraBadgesCount || 0,
                            scrapedAt: data.scrapedAt || new Date().toISOString()
                        };
                    }
                    resolve();
                },
                end: () => resolve()
            })
        };
        scrapeHandler(mockReq, mockRes).catch(() => resolve());
    });
} catch (e) {
    console.warn('Initial live scrape timed out or had error. Adding with 0 badges (background sync will rescrape).');
}

const newParticipant = {
    id: newId,
    name,
    email,
    profileUrl,
    profileStatus: "All Good",
    accessCode: "",
    redemptionStatus: "Yes",
    originalMilestone: "No Milestone",
    completedCount: scrapeData.completedCount,
    completedBadges: scrapeData.completedBadges,
    totalProfileBadges: scrapeData.totalProfileBadges,
    lastScrapedAt: scrapeData.scrapedAt,
    extraBadges: scrapeData.extraBadges,
    extraBadgesCount: scrapeData.extraBadgesCount
};

participants.push(newParticipant);

// Save back to participants.json
fs.writeFileSync(DATA_FILE, JSON.stringify(participants, null, 2), 'utf-8');

console.log(`\nSuccessfully added ${name}!`);
console.log(`  Completed Badges: ${newParticipant.completedCount}/10`);
console.log(`  Total Participants: ${participants.length}`);
console.log(`\nNext steps:`);
console.log(`  1. git add public/data/participants.json`);
console.log(`  2. git commit -m "feat: add participant ${name}"`);
console.log(`  3. git push origin main`);
console.log(`  4. On VPS: git pull && pm2 restart gdg-sync`);
