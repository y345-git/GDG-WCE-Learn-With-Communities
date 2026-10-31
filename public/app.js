// Cloud N Beyond Workshop — GDG On Campus WCE Live Tracker
// High-Performance Silent Sync Engine

const LOCAL_STORAGE_KEY = 'gdgc_wce_cloud_n_beyond_cache_v5';

let state = {
    participants: [],
    targetBadges: [],
    milestoneFilter: '',
    badgeFilter: '',
    searchQuery: '',
    sortBy: 'count_desc',
    viewMode: 'table', // Default to ranked leaderboard
    modalParticipantId: null,

    // High-Speed Background Sync
    autoSyncEnabled: true,
    syncQueue: [],
    syncingSet: new Set(),
    syncedCount: 0,
    totalToSync: 0,
    workerPoolSize: 6, // 6 concurrent workers with staggering
    activeWorkers: 0,

    // Performance throttles
    needsRender: false,
    renderThrottleTimer: null,
    storageSaveTimer: null,
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

        // 2. Fetch Participants from localStorage cache first
        const cached = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    state.participants = parsed;
                }
            } catch (e) {
                console.warn('Cache parse error:', e);
            }
        }

        // If no cache, load baseline JSON
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

// Swag Rewards Helper (Clean: only T-Shirt at 10, only Bottle at 5)
function getSwagRewardInfo(count) {
    if (count >= 10) {
        return {
            stage: 'Stage 2',
            reward: 'T-Shirt',
            badgeClass: 'bg-purple-100 text-purple-900 border-purple-200',
            pillLabel: '👕 T-Shirt',
            isTShirt: true,
            isBottle: false
        };
    } else if (count >= 5) {
        return {
            stage: 'Stage 1',
            reward: 'Bottle',
            badgeClass: 'bg-emerald-100 text-emerald-900 border-emerald-200',
            pillLabel: '🍼 Bottle',
            isTShirt: false,
            isBottle: true
        };
    } else if (count >= 1) {
        const needed = 5 - count;
        return {
            stage: 'In Progress',
            reward: `Needs ${needed} for Bottle`,
            badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
            pillLabel: `${needed} to Bottle 🍼`,
            isTShirt: false,
            isBottle: false
        };
    }
    return {
        stage: 'Not Started',
        reward: 'Needs 5 for Bottle',
        badgeClass: 'bg-slate-50 text-slate-400 border-slate-200',
        pillLabel: 'Not Started',
        isTShirt: false,
        isBottle: false
    };
}

// Update KPI Stats and Filter Counts
function updateStats() {
    const list = state.participants;
    const total = list.length;
    let tshirts = 0, bottles = 0, inProg = 0, zero = 0, totalBadges = 0;

    for (const p of list) {
        const c = p.completedCount || 0;
        totalBadges += c;
        if (c >= 10) {
            tshirts++;
        } else if (c >= 5) {
            bottles++;
        } else if (c >= 1) {
            inProg++;
        } else {
            zero++;
        }
    }

    document.getElementById('kpiTotal').textContent = total;
    document.getElementById('kpiTShirt').textContent = tshirts;
    document.getElementById('kpiBottle').textContent = bottles;
    document.getElementById('kpiInProg').textContent = inProg;
    document.getElementById('kpiTotalBadges').textContent = totalBadges;
    
    const avg = total > 0 ? (totalBadges / total).toFixed(1) : 0;
    const avgPct = total > 0 ? ((totalBadges / (total * 10)) * 100).toFixed(1) : 0;
    document.getElementById('kpiAvgBadges').textContent = `${avg} avg / student`;
    document.getElementById('kpiCompletionRate').textContent = `${avgPct}% Workshop Completion`;

    // Filter pill numbers
    document.getElementById('countPillAll').textContent = total;
    document.getElementById('countPillM3').textContent = tshirts;
    document.getElementById('countPillBottle').textContent = bottles;
    document.getElementById('countPillInProg').textContent = inProg;
    document.getElementById('countPillZero').textContent = zero;

    renderCurriculumModalContent();
}

// Render the 10 Badges Syllabus Modal Content
function renderCurriculumModalContent() {
    const container = document.getElementById('curriculumBadgesList');
    if (!container || !state.targetBadges || state.targetBadges.length === 0) return;

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
                    <div class="w-7 h-7 rounded-full bg-purple-50 text-purple-700 border border-purple-200 flex items-center justify-center font-black text-xs shrink-0 mt-0.5">
                        ${tb.order}
                    </div>
                    <div class="min-w-0">
                        <div class="font-extrabold text-slate-800 text-xs leading-snug">
                            ${escapeHtml(tb.name)}
                        </div>
                        <div class="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
                            <span>${tb.credits} Credits required</span>
                            <span>•</span>
                            <span class="font-bold text-slate-700">${completedCount} completed (${pct}%)</span>
                        </div>
                    </div>
                </div>

                <div class="flex items-center gap-2 shrink-0">
                    <button onclick="toggleBadgeFilter('${norm}'); closeCurriculumModal();" class="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all">
                        Filter
                    </button>
                    <a href="${tb.url}" target="_blank" class="p-1 rounded-lg text-slate-400 hover:text-purple-700 transition-colors">
                        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                    </a>
                </div>
            </div>
        `;
    }).join('');
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

    // Swag Stage & Milestone Filters
    if (state.milestoneFilter) {
        if (state.milestoneFilter === '10') {
            // Stage 2: T-Shirt Winners (10 badges)
            list = list.filter(p => p.completedCount >= 10);
        } else if (state.milestoneFilter === 'bottle_stage') {
            // Stage 1: Bottle Winners (5-9 badges)
            list = list.filter(p => p.completedCount >= 5 && p.completedCount < 10);
        } else if (state.milestoneFilter === 'in_progress_total') {
            // In Progress (1-4 badges)
            list = list.filter(p => p.completedCount >= 1 && p.completedCount < 5);
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
    }

    return list;
}

// Scheduled Render (Throttled for zero lag)
function scheduleRender() {
    if (state.renderThrottleTimer) return;
    state.renderThrottleTimer = setTimeout(() => {
        state.renderThrottleTimer = null;
        renderParticipants();
        updateStats();
    }, 350); // Updates at most ~3 times per second
}

// Debounced Storage Save
function scheduleStorageSave() {
    if (state.storageSaveTimer) return;
    state.storageSaveTimer = setTimeout(() => {
        state.storageSaveTimer = null;
        try {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state.participants));
        } catch (e) {}
    }, 4000);
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
}

function getInitials(name) {
    if (!name) return 'WCE';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Render Table Row for Leaderboard (Fast, pure HTML strings)
function renderTableRow(p, rank) {
    const count = p.completedCount || 0;
    const pct = Math.round((count / 10) * 100);
    const completedSet = new Set((p.completedBadges || []).map(b => (b.normalizedName || '').toLowerCase()));
    const isCurrentlySyncing = state.syncingSet.has(p.id);
    const swag = getSwagRewardInfo(count);

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
                <span class="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-black ${
                    isDone ? 'bg-[#34a853] text-white shadow-2xs' : 'bg-slate-100 text-slate-300'
                }">
                    ${isDone ? '✓' : (idx + 1)}
                </span>
                <span class="tooltip-content">${escapeHtml(tb.name)}<br>${isDone ? 'Completed' : 'Pending'}</span>
            </span>
        `;
    }).join('');

    return `
        <tr id="row-p-${p.id}" class="hover:bg-slate-50/80 transition-colors">
            <td class="py-3.5 px-4 text-center">
                ${rankDisplay}
            </td>
            <td class="py-3.5 px-4">
                <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-xl bg-slate-100 text-slate-700 font-black text-xs flex items-center justify-center shrink-0 border border-slate-200">
                        ${getInitials(p.name)}
                    </div>
                    <div class="min-w-0">
                        <div class="font-extrabold text-slate-900 truncate leading-snug flex items-center gap-1.5">
                            <span class="truncate">${escapeHtml(p.name)}</span>
                            <!-- Sync spinning icon appears ONLY if currently syncing -->
                            ${isCurrentlySyncing ? `
                                <svg class="animate-spin h-3.5 w-3.5 text-purple-600 shrink-0 inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            ` : ''}
                        </div>
                        <div class="text-[11px] text-slate-400 font-mono truncate">${escapeHtml(p.email)}</div>
                    </div>
                </div>
            </td>
            <td class="py-3.5 px-3">
                <div class="w-28">
                    <div class="flex items-center justify-between text-[11px] mb-1">
                        <span class="font-black text-slate-800 font-mono">${count}/10</span>
                        <span class="text-slate-400 font-semibold">${pct}%</span>
                    </div>
                    <div class="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                        <div class="h-1.5 rounded-full ${count >= 10 ? 'bg-purple-600' : count >= 5 ? 'bg-emerald-600' : 'bg-[#1a73e8]'} smooth-progress" style="width: ${pct}%"></div>
                    </div>
                </div>
            </td>
            <td class="py-3.5 px-3">
                <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black border ${swag.badgeClass}">
                    <span>${swag.pillLabel}</span>
                </span>
            </td>
            <td class="py-3.5 px-2 text-center">
                <div class="inline-flex items-center gap-1 bg-slate-50 p-1 rounded-xl border border-slate-200/60">
                    ${dotsHtml}
                </div>
            </td>
            <td class="py-3.5 px-4 text-right">
                <div class="flex items-center justify-end gap-1.5">
                    <a href="${p.profileUrl}" target="_blank" title="Skills Profile" class="p-1.5 rounded-lg text-slate-400 hover:text-purple-600 hover:bg-slate-100 transition-colors inline-flex items-center">
                        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
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
    const swag = getSwagRewardInfo(count);

    const completedSet = new Set((p.completedBadges || []).map(b => (b.normalizedName || '').toLowerCase()));

    // 10 Mini Badge Dots Ribbon
    const dotsHtml = (state.targetBadges || []).map((tb, idx) => {
        const norm = (tb.normalizedName || '').toLowerCase();
        const isDone = completedSet.has(norm);
        return `
            <div class="has-tooltip inline-block">
                <div class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    isDone ? 'bg-[#34a853] text-white shadow-2xs' : 'bg-slate-100 text-slate-400 border border-slate-200'
                }">
                    ${isDone ? '✓' : (idx + 1)}
                </div>
                <div class="tooltip-content">
                    <strong>B#${idx + 1}: ${escapeHtml(tb.name)}</strong><br>
                    ${isDone ? 'Completed' : 'Pending'}
                </div>
            </div>
        `;
    }).join('');

    return `
        <div id="p-card-${p.id}" class="bg-white rounded-3xl p-4 border border-slate-200/90 card-shadow transition-all flex flex-col justify-between relative overflow-hidden">
            <div>
                <!-- Top Row: Avatar, Name, Email, Swag Badge -->
                <div class="flex items-start justify-between gap-3">
                    <div class="flex items-center gap-3 min-w-0">
                        <div class="w-10 h-10 rounded-2xl bg-slate-100 text-slate-700 font-black text-xs flex items-center justify-center shrink-0 border border-slate-200">
                            ${initials}
                        </div>
                        <div class="min-w-0">
                            <h3 class="font-extrabold text-slate-900 text-xs truncate leading-snug flex items-center gap-1.5" title="${escapeHtml(p.name)}">
                                <span>${escapeHtml(p.name)}</span>
                                ${isCurrentlySyncing ? `
                                    <svg class="animate-spin h-3.5 w-3.5 text-purple-600 shrink-0 inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                ` : ''}
                            </h3>
                            <p class="text-[11px] text-slate-400 font-mono truncate" title="${escapeHtml(p.email)}">
                                ${escapeHtml(p.email)}
                            </p>
                        </div>
                    </div>
                    <div class="shrink-0">
                        <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black border ${swag.badgeClass}">
                            <span>${swag.pillLabel}</span>
                        </span>
                    </div>
                </div>

                <!-- Progress Bar -->
                <div class="mt-4">
                    <div class="flex items-center justify-between text-xs mb-1">
                        <span class="font-bold text-slate-600">Workshop Track:</span>
                        <span class="font-black text-slate-900 font-mono">${count} / 10 <span class="text-slate-400 font-normal">(${pct}%)</span></span>
                    </div>
                    <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div class="h-2 rounded-full ${count >= 10 ? 'bg-purple-600' : count >= 5 ? 'bg-emerald-600' : 'bg-[#1a73e8]'} smooth-progress" style="width: ${pct}%"></div>
                    </div>
                </div>

                <!-- 10 Badges Mini Ribbon -->
                <div class="mt-3.5 pt-3 border-t border-slate-100">
                    <div class="text-[10px] text-slate-400 uppercase font-bold mb-1.5 flex items-center justify-between">
                        <span>10 Workshop Badges</span>
                        ${p.lastScrapedAt ? `<span class="text-emerald-600 font-medium lowercase">verified</span>` : ''}
                    </div>
                    <div class="flex items-center justify-between gap-1">
                        ${dotsHtml}
                    </div>
                </div>
            </div>

            <!-- Bottom Actions -->
            <div class="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                <a href="${p.profileUrl}" target="_blank" class="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-purple-600 font-semibold transition-colors">
                    <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                    <span>Profile</span>
                </a>

                <button onclick="openModal(${p.id})" class="px-3 py-1 rounded-xl text-[11px] font-bold bg-slate-900 hover:bg-slate-800 text-white transition-all shadow-2xs">
                    Details
                </button>
            </div>
        </div>
    `;
}

// =========================================================================
// HIGH-SPEED SMOOTH BACKGROUND SYNC (SILENT, ZERO LAG)
// =========================================================================

function initAutoSyncQueue() {
    if (!state.autoSyncEnabled) return;

    // Prioritized queue: active learners (>0) first, then remainder
    const activeFirst = [...state.participants].sort((a, b) => (b.completedCount || 0) - (a.completedCount || 0));
    state.syncQueue = activeFirst.map(p => p.id);
    state.totalToSync = state.syncQueue.length;
    state.syncedCount = 0;

    // Launch worker pool with staggered start to keep UI thread 100% fluid
    for (let i = 0; i < state.workerPoolSize; i++) {
        setTimeout(() => processNextInQueue(), i * 60);
    }
}

async function processNextInQueue() {
    if (!state.autoSyncEnabled) return;

    if (state.syncQueue.length === 0) {
        // Complete cycle, rest 30s before re-checking
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

    // Mark single row/card with spinning sync icon
    updateSingleRowSyncState(participant.id, true);

    try {
        const result = await fetchLiveProfile(participant.profileUrl);
        if (result && result.success) {
            handleLiveScrapeUpdate(participant, result);
        }
    } catch (err) {
        // Silent error handling
    } finally {
        state.syncingSet.delete(participant.id);
        state.activeWorkers--;
        state.syncedCount++;

        // Clear sync icon from row
        updateSingleRowSyncState(participant.id, false);

        // Schedule next request with slight micro-delay for smooth 60fps rendering
        setTimeout(() => processNextInQueue(), 40);
    }
}

async function fetchLiveProfile(url) {
    const resp = await fetch(`/api/scrape?url=${encodeURIComponent(url)}`);
    return await resp.json();
}

// Update single row's sync spinner without full re-render
function updateSingleRowSyncState(id, isSyncing) {
    const row = document.getElementById(`row-p-${id}`);
    if (!row) return;

    const spinner = row.querySelector('.animate-spin');
    if (isSyncing && !spinner) {
        const nameContainer = row.querySelector('.font-extrabold.text-slate-900');
        if (nameContainer) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'animate-spin h-3.5 w-3.5 text-purple-600 shrink-0 inline-block');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('fill', 'none');
            svg.innerHTML = '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>';
            nameContainer.appendChild(svg);
        }
    } else if (!isSyncing && spinner) {
        spinner.remove();
    }
}

// Handle Scrape Update (Silent, debounced storage & render)
function handleLiveScrapeUpdate(participant, result) {
    const countChanged = (participant.completedCount !== result.completedCount);

    participant.completedCount = result.completedCount || 0;
    participant.completedBadges = result.completedBadges || [];
    participant.totalProfileBadges = result.totalBadgesOnProfile || participant.completedCount;
    participant.extraBadges = result.extraBadges || [];
    participant.extraBadgesCount = result.extraBadgesCount || 0;
    participant.lastScrapedAt = result.scrapedAt || new Date().toISOString();

    // Debounced storage save
    scheduleStorageSave();

    // If badge count changed, schedule a throttled render so user sees progress immediately
    if (countChanged) {
        scheduleRender();
    }

    if (state.modalParticipantId === participant.id) {
        renderModalContent(participant);
    }
}

function toggleAutoSync() {
    state.autoSyncEnabled = !state.autoSyncEnabled;
    const icon = document.getElementById('toggleSyncIcon');
    const label = document.getElementById('syncIndicatorLabel');
    const dot = document.getElementById('syncIndicatorDot');

    if (state.autoSyncEnabled) {
        icon.setAttribute('data-lucide', 'pause');
        if (label) label.textContent = 'Live Sync Active';
        if (dot) dot.className = 'w-2 h-2 rounded-full bg-emerald-500 radar-dot shrink-0';
        initAutoSyncQueue();
    } else {
        icon.setAttribute('data-lucide', 'play');
        if (label) label.textContent = 'Sync Paused';
        if (dot) dot.className = 'w-2 h-2 rounded-full bg-amber-400 shrink-0';
    }
    lucide.createIcons();
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
    document.getElementById('modalScrapedAt').textContent = p.lastScrapedAt 
        ? new Date(p.lastScrapedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : 'Initial Snapshot';
    document.getElementById('modalProfileLink').href = p.profileUrl;

    const count = p.completedCount || 0;
    const pct = Math.round((count / 10) * 100);
    const swag = getSwagRewardInfo(count);

    document.getElementById('modalCount').textContent = `${count} / 10`;
    document.getElementById('modalPercent').textContent = `${pct}% Complete`;
    document.getElementById('modalProgressBar').style.width = `${pct}%`;
    document.getElementById('modalRewardStatus').textContent = swag.reward;

    // Swag Badge
    const swagBadgeEl = document.getElementById('modalSwagBadge');
    swagBadgeEl.className = `px-2.5 py-0.5 rounded-full text-[11px] font-black border ${swag.badgeClass}`;
    swagBadgeEl.textContent = `${swag.stage}: ${swag.reward}`;

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
                        <a href="${tb.url}" target="_blank" class="text-[11px] font-bold text-purple-700 hover:underline inline-flex items-center gap-0.5">
                            <span>Syllabus</span>
                            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
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
}

async function syncCurrentModalStudent() {
    if (!state.modalParticipantId) return;
    const btn = document.getElementById('modalSyncNowBtn');
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<svg class="animate-spin h-3.5 w-3.5 inline-block mr-1 text-white" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><span>Scraping...</span>`;
    btn.disabled = true;

    const p = state.participants.find(item => item.id === state.modalParticipantId);
    if (p) {
        try {
            const res = await fetchLiveProfile(p.profileUrl);
            if (res && res.success) {
                handleLiveScrapeUpdate(p, res);
                renderModalContent(p);
            }
        } catch (e) {}
    }

    btn.innerHTML = origHtml;
    btn.disabled = false;
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
    searchTimer = setTimeout(renderParticipants, 100);
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
    else if (val === 'bottle_stage') document.getElementById('pillBottle').classList.add('active-tab');
    else if (val === 'in_progress_total') document.getElementById('pillInProg').classList.add('active-tab');
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
    if (state.milestoneFilter === '10') desc.push('Stage 2: 👕 T-Shirt Winners (10 Badges)');
    else if (state.milestoneFilter === 'bottle_stage') desc.push('Stage 1: 🍼 Bottle Winners (5-9 Badges)');
    else if (state.milestoneFilter === 'in_progress_total') desc.push('In Progress (1-4 Badges)');
    else if (state.milestoneFilter === 'not_started') desc.push('Not Started (0 Badges)');

    if (state.badgeFilter) {
        const b = state.targetBadges.find(item => item.normalizedName === state.badgeFilter);
        desc.push(`Completed: ${b ? b.name : state.badgeFilter}`);
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
    const rows = participants.map((p, idx) => {
        const count = p.completedCount || 0;
        const swag = getSwagRewardInfo(count);
        return {
            "Rank": idx + 1,
            "User Name": p.name,
            "User Email": p.email,
            "Google Skills Profile URL": p.profileUrl,
            "Swag Reward": swag.reward,
            "Swag Stage": swag.stage,
            "Live Completed Badges Count": count,
            "Completed Badges List": (p.completedBadges || []).map(b => b.name).join('; '),
            "Total Profile Badges": p.totalProfileBadges || count,
            "Access Code": p.accessCode || '',
            "Last Verified At": p.lastScrapedAt || 'Initial Snapshot'
        };
    });

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
    XLSX.utils.book_append_sheet(wb, ws1, "Cloud N Beyond Swag Progress");
    XLSX.utils.book_append_sheet(wb, ws2, "10 Badges Track Summary");

    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Cloud_N_Beyond_WCE_Live_Tracking_${dateStr}.xlsx`);
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
}
