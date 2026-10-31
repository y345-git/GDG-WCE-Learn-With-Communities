// Google Developer Groups On Campus WCE - Cloud Workshop Live Tracker
// Automated Continuous Live Background Sync Engine

const LOCAL_STORAGE_KEY = 'gdgc_wce_participants_cache_v3';

let state = {
    participants: [],
    targetBadges: [],
    milestoneFilter: '',
    badgeFilter: '',
    searchQuery: '',
    sortBy: 'count_desc',
    viewMode: 'table', // Default to clean ranked leaderboard table
    modalParticipantId: null,

    // Automated Background Sync Engine State
    autoSyncEnabled: true,
    syncQueue: [],
    syncingSet: new Set(),
    syncedCount: 0,
    totalToSync: 0,
    workerPoolSize: 3, // Concurrent requests to /api/scrape
    activeWorkers: 0,
};

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
    await loadInitialData();
    initAutoSyncQueue();
});

// Load Initial Data
async function loadInitialData() {
    try {
        // 1. Fetch Target Badges
        const bResp = await fetch('/data/badges.json');
        state.targetBadges = await bResp.json();
        renderCurriculumModalContent();

        // 2. Fetch Participants (Check localStorage cache first for latest live data)
        const cached = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    state.participants = parsed;
                }
            } catch (e) {
                console.warn('Cache parse error, loading fresh JSON:', e);
            }
        }

        // If no cache, fetch initial baseline JSON
        if (!state.participants || state.participants.length === 0) {
            const pResp = await fetch('/data/participants.json');
            state.participants = await pResp.json();
        }

        updateStats();
        renderParticipants();

    } catch (err) {
        console.error('Error loading initial data:', err);
    }
}

// Compute Milestone name based on 10-badge count
function getMilestoneName(count) {
    if (count >= 10) return 'Milestone 3';
    if (count >= 5) return 'Milestone 2';
    if (count >= 3) return 'Milestone 1';
    return 'No Milestone';
}

// Update KPI Stats and Filter Counts
function updateStats() {
    const list = state.participants;
    const total = list.length;
    let m3 = 0, m2 = 0, m1 = 0, inProg = 0, zero = 0, totalBadges = 0;

    for (const p of list) {
        const c = p.completedCount || 0;
        totalBadges += c;
        if (c >= 10) m3++;
        else if (c >= 5) m2++;
        else if (c >= 3) m1++;
        else if (c >= 1) inProg++;
        else zero++;
    }

    document.getElementById('kpiTotal').textContent = total;
    document.getElementById('kpiM3').textContent = m3;
    document.getElementById('kpiM2').textContent = m2;
    document.getElementById('kpiM1').textContent = m1;
    document.getElementById('kpiInProg').textContent = inProg;
    document.getElementById('kpiTotalBadges').textContent = totalBadges;
    
    const avg = total > 0 ? (totalBadges / total).toFixed(1) : 0;
    const avgPct = total > 0 ? ((totalBadges / (total * 10)) * 100).toFixed(1) : 0;
    document.getElementById('kpiAvgBadges').textContent = `${avg} avg / student`;
    document.getElementById('kpiCompletionRate').textContent = `${avgPct}% Overall Completion`;

    // Filter pill numbers
    document.getElementById('countPillAll').textContent = total;
    document.getElementById('countPillM3').textContent = m3;
    document.getElementById('countPillM2').textContent = m2;
    document.getElementById('countPillM1').textContent = m1;
    document.getElementById('countPillInProg').textContent = inProg;
    document.getElementById('countPillZero').textContent = zero;

    renderCurriculumModalContent();
}

// Render the 10 Badges Syllabus Modal Content
function renderCurriculumModalContent() {
    const container = document.getElementById('curriculumBadgesList');
    if (!container || !state.targetBadges || state.targetBadges.length === 0) return;

    // Count completions for each target badge
    const badgeCountMap = new Map();
    for (const p of state.participants) {
        if (!p.completedBadges) continue;
        for (const b of p.completedBadges) {
            const norm = (b.normalizedName || '').trim().toLowerCase();
            badgeCountMap.set(norm, (badgeCountMap.get(norm) || 0) + 1);
        }
    }

    const totalStudents = state.participants.length || 363;

    container.innerHTML = state.targetBadges.map((tb) => {
        const norm = (tb.normalizedName || '').trim().toLowerCase();
        const completedCount = badgeCountMap.get(norm) || 0;
        const pct = Math.round((completedCount / totalStudents) * 100);

        return `
            <div class="p-3.5 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 transition-all flex items-center justify-between gap-3">
                <div class="flex items-start gap-3 min-w-0">
                    <div class="w-7 h-7 rounded-full bg-blue-50 text-[#1a73e8] border border-blue-100 flex items-center justify-center font-black text-xs shrink-0 mt-0.5">
                        ${tb.order}
                    </div>
                    <div class="min-w-0">
                        <div class="font-extrabold text-slate-800 text-xs leading-snug">
                            ${escapeHtml(tb.name)}
                        </div>
                        <div class="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
                            <span>${tb.credits} Credits required</span>
                            <span>•</span>
                            <span class="font-bold text-slate-700">${completedCount} students finished (${pct}%)</span>
                        </div>
                    </div>
                </div>

                <div class="flex items-center gap-2 shrink-0">
                    <button onclick="toggleBadgeFilter('${norm}'); closeCurriculumModal();" class="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all">
                        Filter
                    </button>
                    <a href="${tb.url}" target="_blank" class="p-1 rounded-lg text-slate-400 hover:text-blue-600 transition-colors">
                        <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
                    </a>
                </div>
            </div>
        `;
    }).join('');

    lucide.createIcons();
}

function openCurriculumModal() {
    renderCurriculumModalContent();
    document.getElementById('curriculumModal').classList.remove('hidden');
}

function closeCurriculumModal() {
    document.getElementById('curriculumModal').classList.add('hidden');
}

// Filter and Sort Participants
function getFilteredAndSortedParticipants() {
    let list = [...state.participants];

    // Search query
    if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        list = list.filter(p => 
            (p.name && p.name.toLowerCase().includes(q)) ||
            (p.email && p.email.toLowerCase().includes(q)) ||
            (p.accessCode && p.accessCode.toLowerCase().includes(q))
        );
    }

    // Milestone Filter
    if (state.milestoneFilter) {
        if (state.milestoneFilter === '10') {
            list = list.filter(p => p.completedCount >= 10);
        } else if (state.milestoneFilter === 'milestone_2') {
            list = list.filter(p => p.completedCount >= 5 && p.completedCount < 10);
        } else if (state.milestoneFilter === 'milestone_1') {
            list = list.filter(p => p.completedCount >= 3 && p.completedCount < 5);
        } else if (state.milestoneFilter === 'in_progress') {
            list = list.filter(p => p.completedCount >= 1 && p.completedCount < 3);
        } else if (state.milestoneFilter === 'not_started') {
            list = list.filter(p => !p.completedCount || p.completedCount === 0);
        }
    }

    // Badge Filter
    if (state.badgeFilter) {
        list = list.filter(p => {
            if (!p.completedBadges) return false;
            return p.completedBadges.some(b => (b.normalizedName || '').toLowerCase() === state.badgeFilter);
        });
    }

    // Sort
    if (state.sortBy === 'count_desc') {
        list.sort((a, b) => (b.completedCount || 0) - (a.completedCount || 0) || a.name.localeCompare(b.name));
    } else if (state.sortBy === 'count_asc') {
        list.sort((a, b) => (a.completedCount || 0) - (b.completedCount || 0) || a.name.localeCompare(b.name));
    } else if (state.sortBy === 'name_asc') {
        list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (state.sortBy === 'name_desc') {
        list.sort((a, b) => b.name.localeCompare(a.name));
    } else if (state.sortBy === 'synced_desc') {
        list.sort((a, b) => (b.lastScrapedAt || '').localeCompare(a.lastScrapedAt || '') || (b.completedCount || 0) - (a.completedCount || 0));
    }

    return list;
}

// Render Participants (Leaderboard Table or Grid)
function renderParticipants() {
    const list = getFilteredAndSortedParticipants();
    const grid = document.getElementById('participantGrid');
    const tbody = document.getElementById('participantTableBody');
    const noResults = document.getElementById('noResultsNotice');

    if (list.length === 0) {
        grid.innerHTML = '';
        tbody.innerHTML = '';
        noResults.classList.remove('hidden');
        return;
    }
    noResults.classList.add('hidden');

    if (state.viewMode === 'table') {
        tbody.innerHTML = list.map((p, idx) => renderTableRow(p, idx + 1)).join('');
    } else {
        grid.innerHTML = list.map(p => renderParticipantCard(p)).join('');
    }

    updateFilterNotice(list.length);
    lucide.createIcons();
}

// Initials Avatar
function getInitials(name) {
    if (!name) return 'WCE';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Milestone Badge HTML
function getMilestoneBadgeHtml(count) {
    if (count >= 10) {
        return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-amber-50 text-amber-900 border border-amber-300 shadow-2xs">
            <span>🏆</span> Milestone 3
        </span>`;
    } else if (count >= 5) {
        return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-indigo-50 text-indigo-900 border border-indigo-200">
            <span>🥈</span> Milestone 2
        </span>`;
    } else if (count >= 3) {
        return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-sky-50 text-sky-900 border border-sky-200">
            <span>🥉</span> Milestone 1
        </span>`;
    } else if (count >= 1) {
        return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
            <span>⚡</span> In Progress
        </span>`;
    }
    return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-500 border border-slate-200">
        Not Started
    </span>`;
}

// Render Table Row for Leaderboard (De-cluttered and ranked)
function renderTableRow(p, rank) {
    const count = p.completedCount || 0;
    const pct = Math.round((count / 10) * 100);
    const completedSet = new Set((p.completedBadges || []).map(b => (b.normalizedName || '').toLowerCase()));
    const isCurrentlySyncing = state.syncingSet.has(p.id);

    // Rank Medal / Icon
    let rankDisplay = '';
    if (rank === 1 && count > 0) rankDisplay = '<span class="text-base" title="Rank 1">🥇</span>';
    else if (rank === 2 && count > 0) rankDisplay = '<span class="text-base" title="Rank 2">🥈</span>';
    else if (rank === 3 && count > 0) rankDisplay = '<span class="text-base" title="Rank 3">🥉</span>';
    else rankDisplay = `<span class="font-bold font-mono text-slate-400">#${rank}</span>`;

    // 10 Mini Track Dots
    const dotsHtml = (state.targetBadges || []).map((tb, idx) => {
        const norm = (tb.normalizedName || '').toLowerCase();
        const isDone = completedSet.has(norm);
        return `
            <span class="has-tooltip inline-block">
                <span class="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-black transition-all ${
                    isDone ? 'bg-[#34a853] text-white shadow-2xs' : 'bg-slate-100 text-slate-300'
                }">
                    ${isDone ? '✓' : (idx + 1)}
                </span>
                <span class="tooltip-content">${escapeHtml(tb.name)}<br>${isDone ? 'Completed' : 'Pending'}</span>
            </span>
        `;
    }).join('');

    return `
        <tr id="row-p-${p.id}" class="hover:bg-slate-50/80 transition-colors ${isCurrentlySyncing ? 'bg-blue-50/40' : ''}">
            <td class="py-3 px-4 text-center">
                ${rankDisplay}
            </td>
            <td class="py-3 px-4">
                <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-xl bg-slate-100 text-slate-700 font-black text-xs flex items-center justify-center shrink-0 border border-slate-200">
                        ${getInitials(p.name)}
                    </div>
                    <div class="min-w-0">
                        <div class="font-extrabold text-slate-900 truncate leading-snug">${escapeHtml(p.name)}</div>
                        <div class="text-[11px] text-slate-400 font-mono truncate">${escapeHtml(p.email)}</div>
                    </div>
                </div>
            </td>
            <td class="py-3 px-3">
                <div class="w-28">
                    <div class="flex items-center justify-between text-[11px] mb-1">
                        <span class="font-black text-slate-800 font-mono">${count}/10</span>
                        <span class="text-slate-400 font-semibold">${pct}%</span>
                    </div>
                    <div class="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                        <div class="h-1.5 rounded-full ${count >= 10 ? 'bg-amber-500' : count >= 5 ? 'bg-indigo-600' : 'bg-[#1a73e8]'} smooth-progress" style="width: ${pct}%"></div>
                    </div>
                </div>
            </td>
            <td class="py-3 px-3">
                ${getMilestoneBadgeHtml(count)}
            </td>
            <td class="py-3 px-2 text-center">
                <div class="inline-flex items-center gap-1 bg-slate-50/80 p-1 rounded-xl border border-slate-200/60">
                    ${dotsHtml}
                </div>
            </td>
            <td class="py-3 px-4 text-right">
                <div class="flex items-center justify-end gap-1">
                    <button onclick="manualSyncSingle(${p.id}, event)" title="Live sync" class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                        <i data-lucide="refresh-cw" class="w-3.5 h-3.5 ${isCurrentlySyncing ? 'animate-spin text-[#1a73e8]' : ''}"></i>
                    </button>
                    <a href="${p.profileUrl}" target="_blank" title="Skills Profile" class="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-slate-100 transition-colors">
                        <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
                    </a>
                    <button onclick="openModal(${p.id})" class="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors">
                        Details
                    </button>
                </div>
            </td>
        </tr>
    `;
}

// Render Participant Card
function renderParticipantCard(p) {
    const count = p.completedCount || 0;
    const pct = Math.round((count / 10) * 100);
    const initials = getInitials(p.name);
    const isCurrentlySyncing = state.syncingSet.has(p.id);

    const completedSet = new Set((p.completedBadges || []).map(b => (b.normalizedName || '').toLowerCase()));

    // 10 Mini Badge Dots Ribbon
    const dotsHtml = (state.targetBadges || []).map((tb, idx) => {
        const norm = (tb.normalizedName || '').toLowerCase();
        const isDone = completedSet.has(norm);
        return `
            <div class="has-tooltip inline-block">
                <div class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${
                    isDone 
                    ? 'bg-[#34a853] text-white shadow-2xs' 
                    : 'bg-slate-100 text-slate-400 border border-slate-200'
                }">
                    ${isDone ? '✓' : (idx + 1)}
                </div>
                <div class="tooltip-content">
                    <strong>B#${idx + 1}: ${escapeHtml(tb.name)}</strong><br>
                    ${isDone ? '✅ Completed' : '⏳ Pending'}
                </div>
            </div>
        `;
    }).join('');

    return `
        <div id="p-card-${p.id}" class="bg-white rounded-2xl p-4 border border-slate-200/90 card-shadow transition-all flex flex-col justify-between relative overflow-hidden">
            ${isCurrentlySyncing ? `
                <div class="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-[10px] text-blue-700 font-semibold border border-blue-200 animate-pulse">
                    <i data-lucide="refresh-cw" class="w-3 h-3 animate-spin text-[#4285f4]"></i>
                    <span>Live Syncing</span>
                </div>
            ` : ''}

            <div>
                <!-- Top Row: Avatar, Name, Email, Milestone -->
                <div class="flex items-start justify-between gap-3">
                    <div class="flex items-center gap-3 min-w-0">
                        <div class="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 font-black text-xs flex items-center justify-center shrink-0 border border-slate-200">
                            ${initials}
                        </div>
                        <div class="min-w-0">
                            <h3 class="font-extrabold text-slate-900 text-xs truncate leading-snug" title="${escapeHtml(p.name)}">
                                ${escapeHtml(p.name)}
                            </h3>
                            <p class="text-[11px] text-slate-400 font-mono truncate" title="${escapeHtml(p.email)}">
                                ${escapeHtml(p.email)}
                            </p>
                        </div>
                    </div>
                    <div class="shrink-0">
                        ${getMilestoneBadgeHtml(count)}
                    </div>
                </div>

                <!-- Progress Bar -->
                <div class="mt-4">
                    <div class="flex items-center justify-between text-xs mb-1">
                        <span class="font-bold text-slate-600">Workshop Track:</span>
                        <span class="font-black text-slate-900 font-mono">${count} / 10 <span class="text-slate-400 font-normal">(${pct}%)</span></span>
                    </div>
                    <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div class="h-2 rounded-full ${count >= 10 ? 'bg-amber-500' : count >= 5 ? 'bg-indigo-600' : 'bg-[#1a73e8]'} smooth-progress" style="width: ${pct}%"></div>
                    </div>
                </div>

                <!-- 10 Badges Mini Ribbon -->
                <div class="mt-3.5 pt-3 border-t border-slate-100">
                    <div class="text-[10px] text-slate-400 uppercase font-bold mb-1.5 flex items-center justify-between">
                        <span>10 Workshop Badges</span>
                        ${p.lastScrapedAt ? `<span class="text-emerald-600 font-medium lowercase">live verified</span>` : ''}
                    </div>
                    <div class="flex items-center justify-between gap-1">
                        ${dotsHtml}
                    </div>
                </div>
            </div>

            <!-- Bottom Actions -->
            <div class="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                <a href="${p.profileUrl}" target="_blank" class="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-blue-600 font-semibold transition-colors">
                    <i data-lucide="external-link" class="w-3 h-3 text-slate-400"></i>
                    <span>Profile</span>
                </a>

                <div class="flex items-center gap-1.5">
                    <button onclick="manualSyncSingle(${p.id}, event)" title="Live sync" class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                        <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
                    </button>
                    <button onclick="openModal(${p.id})" class="px-3 py-1 rounded-lg text-[11px] font-bold bg-slate-900 hover:bg-slate-800 text-white transition-all shadow-2xs">
                        Details
                    </button>
                </div>
            </div>
        </div>
    `;
}

// =========================================================================
// AUTOMATED CONTINUOUS LIVE BACKGROUND SYNC ENGINE
// =========================================================================

function initAutoSyncQueue() {
    if (!state.autoSyncEnabled) return;

    // Prioritized queue:
    // Active learners (>0 badges) first, then remaining students
    const activeFirst = [...state.participants].sort((a, b) => (b.completedCount || 0) - (a.completedCount || 0));
    state.syncQueue = activeFirst.map(p => p.id);
    state.totalToSync = state.syncQueue.length;
    state.syncedCount = 0;

    updateTickerMessage('Starting automated live verification queue...');

    for (let i = 0; i < state.workerPoolSize; i++) {
        processNextInQueue();
    }
}

async function processNextInQueue() {
    if (!state.autoSyncEnabled) return;

    if (state.syncQueue.length === 0) {
        // Cycle again after 30s for continuous live monitoring
        setTimeout(() => {
            if (state.autoSyncEnabled) initAutoSyncQueue();
        }, 30000);
        return;
    }

    const nextId = state.syncQueue.shift();
    const participant = state.participants.find(p => p.id === nextId);
    if (!participant || !participant.profileUrl) {
        return processNextInQueue();
    }

    state.syncingSet.add(participant.id);
    state.activeWorkers++;

    try {
        updateTickerMessage(`Scraping profile for ${participant.name}...`);
        const result = await fetchLiveProfile(participant.profileUrl);

        if (result && result.success) {
            handleLiveScrapeUpdate(participant, result);
        }
    } catch (err) {
        console.warn(`Sync error for ${participant.name}:`, err);
    } finally {
        state.syncingSet.delete(participant.id);
        state.activeWorkers--;
        state.syncedCount++;

        // Update progress bar
        const pct = Math.round((state.syncedCount / (state.totalToSync || 1)) * 100);
        document.getElementById('tickerPercent').textContent = `${pct}% Verified`;
        document.getElementById('tickerBar').style.width = `${pct}%`;
        document.getElementById('syncCounterBadge').textContent = `${state.syncedCount}/${state.totalToSync}`;

        processNextInQueue();
    }
}

async function fetchLiveProfile(url) {
    const resp = await fetch(`/api/scrape?url=${encodeURIComponent(url)}`);
    return await resp.json();
}

function handleLiveScrapeUpdate(participant, result) {
    const prevCount = participant.completedCount || 0;
    const newCount = result.completedCount || 0;

    participant.completedCount = newCount;
    participant.completedBadges = result.completedBadges || [];
    participant.totalProfileBadges = result.totalBadgesOnProfile || newCount;
    participant.extraBadges = result.extraBadges || [];
    participant.extraBadgesCount = result.extraBadgesCount || 0;
    participant.lastScrapedAt = result.scrapedAt || new Date().toISOString();

    if (newCount > prevCount) {
        showCelebrationToast(participant, prevCount, newCount);
        updateTickerMessage(`🎉 ${participant.name} unlocked ${newCount}/10 badges!`);
    } else {
        updateTickerMessage(`Verified ${participant.name} (${newCount}/10 badges)`);
    }

    try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state.participants));
    } catch (e) {}

    updateStats();
    updateParticipantInDOM(participant);

    if (state.modalParticipantId === participant.id) {
        renderModalContent(participant);
    }
}

// In-place DOM update without full table re-render
function updateParticipantInDOM(p) {
    // If in table view
    const rowEl = document.getElementById(`row-p-${p.id}`);
    if (rowEl) {
        const temp = document.createElement('tbody');
        const filtered = getFilteredAndSortedParticipants();
        const rank = filtered.findIndex(item => item.id === p.id) + 1;
        temp.innerHTML = renderTableRow(p, rank || 1);
        const newRow = temp.firstElementChild;
        newRow.classList.add('card-updated');
        rowEl.replaceWith(newRow);
    }

    // If in card view
    const cardEl = document.getElementById(`p-card-${p.id}`);
    if (cardEl) {
        const temp = document.createElement('div');
        temp.innerHTML = renderParticipantCard(p);
        const newCard = temp.firstElementChild;
        newCard.classList.add('card-updated');
        cardEl.replaceWith(newCard);
    }

    lucide.createIcons();
}

async function manualSyncSingle(id, event) {
    if (event) event.stopPropagation();
    const p = state.participants.find(item => item.id === id);
    if (!p) return;

    state.syncingSet.add(p.id);
    updateParticipantInDOM(p);

    try {
        const result = await fetchLiveProfile(p.profileUrl);
        if (result && result.success) {
            handleLiveScrapeUpdate(p, result);
            showToast('Live Updated', `Refreshed skills profile for ${p.name}`, 'success');
        } else {
            showToast('Notice', result.error || 'Failed to scrape profile', 'info');
        }
    } catch (e) {
        showToast('Error', 'Network error during live scrape', 'error');
    } finally {
        state.syncingSet.delete(p.id);
        updateParticipantInDOM(p);
    }
}

function toggleAutoSync() {
    state.autoSyncEnabled = !state.autoSyncEnabled;
    const icon = document.getElementById('toggleSyncIcon');
    const label = document.getElementById('syncIndicatorLabel');

    if (state.autoSyncEnabled) {
        icon.setAttribute('data-lucide', 'pause');
        label.textContent = 'Live Auto-Sync Active';
        updateTickerMessage('Resuming automated live sync...');
        initAutoSyncQueue();
    } else {
        icon.setAttribute('data-lucide', 'play');
        label.textContent = 'Live Sync Paused';
        updateTickerMessage('Live auto-sync paused by user.');
    }
    lucide.createIcons();
}

function updateTickerMessage(msg) {
    const el = document.getElementById('tickerText');
    if (el) el.textContent = msg;
}

// =========================================================================
// MODAL DOSSIER
// =========================================================================

function openModal(id) {
    state.modalParticipantId = id;
    const p = state.participants.find(item => item.id === id);
    if (!p) return;

    renderModalContent(p);
    document.getElementById('studentModal').classList.remove('hidden');
}

function renderModalContent(p) {
    document.getElementById('modalName').textContent = p.name;
    document.getElementById('modalEmail').textContent = p.email;
    document.getElementById('modalAvatar').textContent = getInitials(p.name);
    document.getElementById('modalAccessCode').textContent = p.accessCode || 'Not provided';
    document.getElementById('modalScrapedAt').textContent = p.lastScrapedAt 
        ? new Date(p.lastScrapedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : 'Initial Snapshot';
    document.getElementById('modalProfileLink').href = p.profileUrl;

    const count = p.completedCount || 0;
    const pct = Math.round((count / 10) * 100);
    document.getElementById('modalCount').textContent = `${count} / 10`;
    document.getElementById('modalPercent').textContent = `${pct}% Complete`;
    document.getElementById('modalProgressBar').style.width = `${pct}%`;

    // Milestone Badge
    document.getElementById('modalMilestoneBadge').innerHTML = getMilestoneBadgeHtml(count);

    // 10 Badges Checklist
    const completedMap = new Map();
    for (const b of (p.completedBadges || [])) {
        completedMap.set((b.normalizedName || '').toLowerCase(), b);
    }

    const listContainer = document.getElementById('modalBadgesList');
    listContainer.innerHTML = (state.targetBadges || []).map((tb) => {
        const norm = (tb.normalizedName || '').toLowerCase();
        const earned = completedMap.get(norm);
        const isDone = !!earned;

        return `
            <div class="flex items-center justify-between p-3 rounded-2xl border ${isDone ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200/90 bg-white'} shadow-2xs">
                <div class="flex items-start gap-3 min-w-0 pr-3">
                    <div class="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-xs font-black ${
                        isDone ? 'bg-[#34a853] text-white' : 'bg-slate-100 text-slate-400 border border-slate-200'
                    }">
                        ${isDone ? '✓' : tb.order}
                    </div>
                    <div class="min-w-0">
                        <div class="font-extrabold text-slate-800 text-xs leading-snug">
                            ${escapeHtml(tb.name)}
                        </div>
                        <div class="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                            <span>${tb.credits} Credits</span>
                            ${isDone && earned.earnedDate ? `<span>•</span><span class="text-emerald-700 font-bold">🗓️ ${escapeHtml(earned.earnedDate)}</span>` : ''}
                        </div>
                    </div>
                </div>

                <div class="shrink-0 flex items-center gap-2">
                    ${tb.url ? `
                        <a href="${tb.url}" target="_blank" class="text-[11px] font-bold text-[#1a73e8] hover:underline inline-flex items-center gap-0.5">
                            <span>Syllabus</span>
                            <i data-lucide="external-link" class="w-3 h-3"></i>
                        </a>
                    ` : ''}
                    <span class="px-2 py-0.5 rounded-md text-[10px] font-extrabold ${
                        isDone ? 'bg-emerald-100 text-emerald-900 border border-emerald-300' : 'bg-slate-100 text-slate-500'
                    }">
                        ${isDone ? 'Completed' : 'Pending'}
                    </span>
                </div>
            </div>
        `;
    }).join('');

    // Extra Non-Target Badges
    const extraCount = p.extraBadgesCount || (p.extraBadges ? p.extraBadges.length : 0);
    const extraBox = document.getElementById('modalExtraBadgesBox');
    if (extraCount > 0) {
        extraBox.classList.remove('hidden');
        document.getElementById('modalExtraCount').textContent = extraCount;
    } else {
        extraBox.classList.add('hidden');
    }

    lucide.createIcons();
}

async function syncCurrentModalStudent() {
    if (!state.modalParticipantId) return;
    const btn = document.getElementById('modalSyncNowBtn');
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>Scraping Live...</span>`;
    btn.disabled = true;
    lucide.createIcons();

    await manualSyncSingle(state.modalParticipantId);

    btn.innerHTML = origHtml;
    btn.disabled = false;
    lucide.createIcons();
}

function closeModal() {
    document.getElementById('studentModal').classList.add('hidden');
    state.modalParticipantId = null;
}

window.addEventListener('click', (e) => {
    if (e.target === document.getElementById('studentModal')) {
        closeModal();
    }
    if (e.target === document.getElementById('curriculumModal')) {
        closeCurriculumModal();
    }
});

// =========================================================================
// SEARCH, FILTER & VIEW TOGGLES
// =========================================================================

let searchTimer = null;
function onSearchChange() {
    const val = document.getElementById('searchInput').value.trim();
    state.searchQuery = val;
    document.getElementById('clearSearchBtn').classList.toggle('hidden', val === '');

    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(renderParticipants, 200);
}

function clearSearch() {
    document.getElementById('searchInput').value = '';
    state.searchQuery = '';
    document.getElementById('clearSearchBtn').classList.add('hidden');
    renderParticipants();
}

function filterMilestone(val) {
    state.milestoneFilter = val;
    document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active-tab'));
    if (val === '') document.getElementById('pillAll').classList.add('active-tab');
    else if (val === '10') document.getElementById('pillM3').classList.add('active-tab');
    else if (val === 'milestone_2') document.getElementById('pillM2').classList.add('active-tab');
    else if (val === 'milestone_1') document.getElementById('pillM1').classList.add('active-tab');
    else if (val === 'in_progress') document.getElementById('pillInProg').classList.add('active-tab');
    else if (val === 'not_started') document.getElementById('pillZero').classList.add('active-tab');

    renderParticipants();
}

function toggleBadgeFilter(norm) {
    state.badgeFilter = (state.badgeFilter === norm) ? '' : norm;
    renderParticipants();
}

function onSortChange() {
    state.sortBy = document.getElementById('sortSelect').value;
    renderParticipants();
}

function setViewMode(mode) {
    state.viewMode = mode;
    const grid = document.getElementById('participantGrid');
    const table = document.getElementById('participantTableWrapper');
    const btnGrid = document.getElementById('btnViewGrid');
    const btnTable = document.getElementById('btnViewTable');

    if (mode === 'grid') {
        grid.classList.remove('hidden');
        table.classList.add('hidden');
        btnGrid.classList.add('bg-white', 'text-slate-800', 'shadow-2xs');
        btnGrid.classList.remove('text-slate-400');
        btnTable.classList.remove('bg-white', 'text-slate-800', 'shadow-2xs');
        btnTable.classList.add('text-slate-400');
    } else {
        grid.classList.add('hidden');
        table.classList.remove('hidden');
        btnTable.classList.add('bg-white', 'text-slate-800', 'shadow-2xs');
        btnTable.classList.remove('text-slate-400');
        btnGrid.classList.remove('bg-white', 'text-slate-800', 'shadow-2xs');
        btnGrid.classList.add('text-slate-400');
    }
    renderParticipants();
}

function updateFilterNotice(count) {
    const notice = document.getElementById('activeFilterNotice');
    const textEl = document.getElementById('activeFilterNoticeText');
    const hasFilter = state.badgeFilter || state.milestoneFilter || state.searchQuery;

    if (!hasFilter) {
        notice.classList.add('hidden');
        notice.classList.remove('flex');
        return;
    }

    const desc = [];
    if (state.searchQuery) desc.push(`"${state.searchQuery}"`);
    if (state.milestoneFilter) desc.push(`Milestone filter: ${state.milestoneFilter}`);
    if (state.badgeFilter) {
        const b = state.targetBadges.find(item => item.normalizedName === state.badgeFilter);
        desc.push(`Completed Badge: ${b ? b.name : state.badgeFilter}`);
    }

    textEl.textContent = `Showing ${count} WCE students matching ${desc.join(' & ')}`;
    notice.classList.remove('hidden');
    notice.classList.add('flex');
}

function resetFilters() {
    state.searchQuery = '';
    state.milestoneFilter = '';
    state.badgeFilter = '';
    document.getElementById('searchInput').value = '';
    document.getElementById('clearSearchBtn').classList.add('hidden');
    filterMilestone('');
    renderParticipants();
}

// =========================================================================
// EXCEL EXPORT (CLIENT-SIDE VIA SHEETJS - ZERO SERVER REQUIRED)
// =========================================================================

function exportToExcel() {
    if (typeof XLSX === 'undefined') {
        alert('Export library loading. Please try again in a moment.');
        return;
    }

    const participants = getFilteredAndSortedParticipants();
    const rows = participants.map((p, idx) => ({
        "Rank": idx + 1,
        "User Name": p.name,
        "User Email": p.email,
        "Google Skills Profile URL": p.profileUrl,
        "Profile Status": p.profileStatus || 'All Good',
        "Access Code": p.accessCode || '',
        "Redemption Status": p.redemptionStatus || 'No',
        "Milestone Completed": getMilestoneName(p.completedCount || 0),
        "Live Completed Badges Count": p.completedCount || 0,
        "Completed Badges List": (p.completedBadges || []).map(b => b.name).join('; '),
        "Total Profile Badges": p.totalProfileBadges || p.completedCount || 0,
        "Last Verified At": p.lastScrapedAt || 'Not Verified Yet'
    }));

    const ws1 = XLSX.utils.json_to_sheet(rows);

    // Sheet 2: 10 Target Badges Breakdown
    const badgeRows = (state.targetBadges || []).map(b => {
        const norm = (b.normalizedName || '').toLowerCase();
        let done = 0;
        for (const p of state.participants) {
            if (p.completedBadges && p.completedBadges.some(cb => (cb.normalizedName || '').toLowerCase() === norm)) {
                done++;
            }
        }
        return {
            "#": b.order,
            "Badge Name": b.name,
            "Course URL": b.url,
            "Required Credits": b.credits,
            "Students Completed": done,
            "Completion Percentage": `${Math.round((done / (state.participants.length || 1)) * 100)}%`
        };
    });
    const ws2 = XLSX.utils.json_to_sheet(badgeRows);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, "WCE Students Live Progress");
    XLSX.utils.book_append_sheet(wb, ws2, "10 Badges Track Summary");

    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `GDGC_WCE_Cloud_Workshop_Live_${dateStr}.xlsx`);
    showToast('Export Complete', 'Live tracking spreadsheet downloaded successfully', 'success');
}

// Celebration Toast
function showCelebrationToast(p, oldC, newC) {
    showToast(
        '🎉 Milestone Unlocked!',
        `${p.name} earned ${newC}/10 badges (${getMilestoneName(newC)})`,
        'success'
    );
}

function showToast(title, message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    const borderColors = {
        success: 'border-[#34a853] bg-white text-slate-800',
        error: 'border-[#ea4335] bg-white text-slate-800',
        info: 'border-[#4285f4] bg-white text-slate-800'
    };

    toast.className = `p-4 rounded-2xl border-l-4 shadow-xl flex items-start gap-3 w-80 text-xs pointer-events-auto transform translate-y-2 opacity-0 transition-all duration-300 ${borderColors[type] || borderColors.info}`;
    toast.innerHTML = `
        <div class="flex-1">
            <strong class="font-extrabold block text-slate-900 leading-snug">${escapeHtml(title)}</strong>
            <span class="text-slate-600 mt-0.5 block leading-relaxed">${escapeHtml(message)}</span>
        </div>
        <button onclick="this.parentElement.remove()" class="text-slate-400 hover:text-slate-600 text-sm">✕</button>
    `;

    container.appendChild(toast);
    setTimeout(() => toast.classList.remove('translate-y-2', 'opacity-0'), 10);
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-x-4');
        setTimeout(() => toast.remove(), 300);
    }, 4500);
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
}
