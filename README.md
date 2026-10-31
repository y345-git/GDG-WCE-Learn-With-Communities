# Google Developer Groups On Campus WCE — Cloud Workshop Live 10-Badge Tracker

A modern, high-performance **JavaScript web application built for Google Developer Groups (GDG) On Campus WCE (Walchand College of Engineering, Sangli)**, designed for direct deployment to **Vercel**.

It extracts and live-tracks participants' completion of the **10 official curriculum badges** directly from their Google Skills public profiles with an **automated background live-sync engine** (no manual clicking required!).

---

## 🎯 The 10 Official Curriculum Badges
Tracked from the [Official Google Sheet](https://docs.google.com/spreadsheets/d/e/2PACX-1vTVMEFW24yi5IVcBblZFEK5xMdQyeF9pndf-wxE37BKu5hyOghhSkYiCHW6rSLjNJd5U3OI_E_I9vZi/pubhtml?gid=411469390&single=true):

1. **The Basics of Google Cloud Compute** (4 credits)
2. **Configure Service Accounts and IAM Roles for Google Cloud** (4 credits)
3. **Implement Speech and Language Solutions with Pre-trained APIs** (4 credits)
4. **Develop AI-Powered Prototypes in Google AI Studio** (0 credits)
5. **Analyze Images with the Cloud Vision API** (12 credits)
6. **Build a Website on Google Cloud** (13 credits)
7. **Create Your First Gemini Enterprise Application** (0 credits)
8. **Store, Process, and Manage Data on Google Cloud - Console** (3 credits)
9. **Using the Google Cloud Speech API** (4 credits)
10. **Explore Generative AI in Agent Platform** (16 credits)

> **Rule Enforced:** The engine strictly counts only these 10 badges. Any other badges on public profiles are categorized as extra/unrelated and ignored from the workshop milestone tally.

---

## ⚡ Active Live Sync (No Manual Clicking Required)

- **Instant Zero-Wait Load**: Boots immediately with all 363 WCE participants.
- **Automated Continuous Background Queue**:
  - Automatically begins scraping profiles in the background as soon as the page loads.
  - Prioritizes active learners, then cycles through all students.
  - Dynamically updates cards and progress bars in real-time as each student finishes a badge.
  - Emits real-time celebratory toast notifications when a student completes a milestone badge (e.g. `🎉 Sahil Behaniye unlocked 6/10 Badges!`).
  - Saves live results to `localStorage` cache so updates persist across page reloads.
  - Live radar pulse indicator in the header: `🟢 Live Auto-Sync Active`.

---

## 🚀 One-Click Deployment to Vercel

This repository is **100% Vercel-native**:
- Zero build tools or heavy packages required.
- Uses native Node.js ESM serverless functions (`/api/scrape` and `/api/batch-scrape`).
- Works on Vercel Hobby, Pro, and Enterprise tiers without exceeding function execution limits.

### Option 1: Deploy via GitHub (Recommended)
1. Push this directory to your GitHub repository.
2. Go to [vercel.com/new](https://vercel.com/new).
3. Select your repository and click **Deploy**.
4. That's it! Vercel automatically detects `vercel.json` and publishes your site.

### Option 2: Deploy via Vercel CLI
```bash
npx vercel
```

---

## 💻 Running Locally

To run and preview the JavaScript webapp locally:

```bash
npm run dev
# or: node server.js
```

Open your browser at **[http://localhost:3000](http://localhost:3000)**.

---

## 🛠️ Project Structure

```
├── api/
│   ├── scrape.js          # Vercel Serverless Function (single profile live scrape)
│   └── batch-scrape.js    # Vercel Serverless Function (parallel batch scrape)
├── public/
│   ├── index.html         # Modern GDG On Campus WCE UI (Tailwind CSS, Lucide)
│   ├── styles.css         # Glassmorphism, animations, and GDG theme styles
│   ├── app.js             # Automated background sync engine, filtering & Excel export
│   └── data/
│       ├── badges.json       # 10 official syllabus badges from Google Sheet
│       └── participants.json # 363 participants from GDGC-WCE01.xlsx
├── vercel.json            # Vercel serverless routing configuration
├── server.js              # Native Node.js dev server for local testing
└── package.json           # Project metadata & npm scripts
```
