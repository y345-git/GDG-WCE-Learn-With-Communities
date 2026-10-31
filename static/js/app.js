// GDG Cloud Workshop Tracker - App Logic

let state = {
    participants: [],
    targetBadges: [],
    stats: {},
    milestoneFilter: '',
    badgeFilter: '',
    searchQuery: '',
    sortBy: 'count_desc',
    currentView: 'grid',
    isSyncing: false,
    syncPollTimer: null,
    currentModalParticipantId: null,
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
    loadAllData();
    checkSyncStatus();
});

// Main Data Fetcher
async function loadAllData() {
    await Promise.all([
        fetchStats(),
        fetchTargetBadges(),
        fetchParticipants()
    ]);
}

// Fetch Stats & KPIs
async function fetchStats() {
    try {
        const resp = await fetch('/api/stats');
        const data = await resp.json();
        if (data.status === 'success') {
            state.stats = data.stats;
            renderStats(data.stats);
            if (data.sync_status && data.sync_status.is_running) {
                startPollingSync();
            }
        }
    } catch (e) {
        console.error('Error fetching stats:', e);
    }
}

// Render Stats
function renderStats(stats) {
    if (!stats) return;
    document.getElementById('kpiTotalParticipants').textContent = stats.total_participants || 363;
    document.getElementById('kpiMilestone3').textContent = stats.milestones.milestone_3 || 0;
    document.getElementById('kpiMilestone2').textContent = stats.milestones.milestone_2 || 0;
    document.getElementById('kpiMilestone1').textContent = stats.milestones.milestone_1 || 0;
    document.getElementById('kpiInProgress').textContent = stats.milestones.in_progress || 0;
    document.getElementById('kpiTotalBadgesEarned').textContent = stats.total_target_badges_earned || 0;
    document.getElementById('kpiAvgBadges').textContent = `Avg: ${stats.average_badges_per_student} badges (${stats.average_percentage}%)`;

    // Filter tab counts
    document.getElementById('countAll').textContent = stats.total_participants || 363;
    document.getElementById('countM3').textContent = stats.milestones.milestone_3 || 0;
    document.getElementById('countM2').textContent = stats.milestones.milestone_2 || 0;
    document.getElementById('countM1').textContent = stats.milestones.milestone_1 || 0;
    document.getElementById('countInProg').textContent = stats.milestones.in_progress || 0;
    document.getElementById('countZero').textContent = stats.milestones.not_started || 0;
}

// Fetch 10 Target Badges
async function fetchTargetBadges() {
    try {
        const resp = await fetch('/api/target-badges');
        const data = await resp.json();
        if (data.status === 'success') {
            state.targetBadges = data.target_badges;
            renderTargetBadges(data.target_badges);
        }
    } catch (e) {
        console.error('Error fetching target badges:', e);
    }
}

// Render Target Badges Grid
function renderTargetBadges(badges) {
    const container = document.getElementById('targetBadgesGrid');
    if (!badges || badges.length === 0) {
        container.innerHTML = '<div class="text-xs text-slate-400">No target badges loaded.</div>';
        return;
    }

    container.innerHTML = badges.map(b => {
        const isSelected = state.badgeFilter === b.normalized_name;
        return `
            <div onclick="toggleBadgeFilter('${b.normalized_name}')" 
                 class="group relative p-3 rounded-xl border ${isSelected ? 'border-google-blue bg-blue-50/60 ring-2 ring-blue-200' : 'border-slate-200/80 bg-white hover:border-slate-300'} shadow-xs cursor-pointer transition-all flex flex-col justify-between">
                <div>
                    <div class="flex items-center justify-between text-[11px] mb-1">
                        <span class="font-bold text-google-blue">Badge #${b.badge_order}</span>
                        <span class="px-1.5 py-0.2 rounded text-[10px] bg-slate-100 text-slate-600 font-medium">${b.credits} Credits</span>
                    </div>
                    <h3 class="text-xs font-semibold text-slate-800 line-clamp-2 group-hover:text-google-blue transition-colors leading-tight" title="${escapeHtml(b.name)}">
                        ${escapeHtml(b.name)}
                    </h3>
                </div>
                <div class="mt-3 pt-2 border-t border-slate-100">
                    <div class="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                        <span>Completed:</span>
                        <span class="font-bold text-slate-700">${b.completed_count} (${b.percentage}%)</span>
                    </div>
                    <div class="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                        <div class="h-1.5 rounded-full bg-google-blue smooth-progress" style="width: ${b.percentage}%"></div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Fetch Participants with Active Filters
async function fetchParticipants() {
    const params = new URLSearchParams();
    if (state.searchQuery) params.append('search', state.searchQuery);
    if (state.milestoneFilter) params.append('milestone', state.milestoneFilter);
    if (state.badgeFilter) params.append('badge', state.badgeFilter);
    if (state.sortBy) params.append('sort_by', state.sortBy);

    try {
        const resp = await fetch(`/api/participants?${params.toString()}`);
        const data = await resp.json();
        if (data.status === 'success') {
            state.participants = data.participants;
            renderParticipants();
            updateActiveFilterBanner();
        }
    } catch (e) {
        console.error('Error fetching participants:', e);
    }
}

// Render Participants (Grid or Table)
function renderParticipants() {
    const list = state.participants;
    const gridContainer = document.getElementById('participantsGridView');
    const tableBody = document.getElementById('participantsTableBody');
    const noResults = document.getElementById('noResultsState');

    if (list.length === 0) {
        gridContainer.innerHTML = '';
        tableBody.innerHTML = '';
        noResults.classList.remove('hidden');
        return;
    }

    noResults.classList.add('hidden');

    if (state.currentView === 'grid') {
        gridContainer.innerHTML = list.map(p => renderParticipantCard(p)).join('');
    } else {
        tableBody.innerHTML = list.map(p => renderTableRow(p)).join('');
    }

    lucide.createIcons();
}

// Milestone Badge Helper
function getMilestoneBadgeHtml(count) {
    if (count >= 10) {
        return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200 shadow-2xs">
            <span>🏆</span> Milestone 3
        </span>`;
    } else if (count >= 5) {
        return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
            <span>🥈</span> Milestone 2
        </span>`;
    } else if (count >= 3) {
        return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
            <span>🥉</span> Milestone 1
        </span>`;
    } else if (count >= 1) {
        return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
            <span>⚡</span> In Progress
        </span>`;
    }
    return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
        Not Started
    </span>`;
}

// Initials Avatar
function getInitials(name) {
    if (!name) return '??';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Render Single Participant Card
function renderParticipantCard(p) {
    const completedSet = new Set((p.completed_badges_list || []).map(b => b.trim().toLowerCase()));
    const initials = getInitials(p.user_name);
    const pct = Math.round((p.completed_count / 10) * 100);

    // Mini 10 Badges Ribbon
    let badgeDotsHtml = '';
    if (state.targetBadges && state.targetBadges.length > 0) {
        badgeDotsHtml = state.targetBadges.map((tb, idx) => {
            const isDone = completedSet.has(tb.normalized_name);
            return `
                <div class="has-tooltip inline-block">
                    <div class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${
                        isDone 
                        ? 'bg-emerald-500 text-white shadow-2xs' 
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
    }

    return `
        <div id="card-p-${p.id}" class="bg-white rounded-xl p-4 border border-slate-200/90 shadow-xs hover:border-slate-300 hover:shadow-sm transition-all flex flex-col justify-between">
            <div>
                <!-- Top Row: Avatar, Name, Milestone Badge -->
                <div class="flex items-start justify-between gap-3">
                    <div class="flex items-center gap-2.5 min-w-0">
                        <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-slate-100 to-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center shrink-0 border border-slate-200">
                            ${initials}
                        </div>
                        <div class="min-w-0">
                            <h3 class="font-bold text-slate-900 text-xs truncate leading-snug" title="${escapeHtml(p.user_name)}">
                                ${escapeHtml(p.user_name)}
                            </h3>
                            <p class="text-[11px] text-slate-500 truncate font-mono" title="${escapeHtml(p.user_email)}">
                                ${escapeHtml(p.user_email)}
                            </p>
                        </div>
                    </div>
                    <div class="shrink-0">
                        ${getMilestoneBadgeHtml(p.completed_count)}
                    </div>
                </div>

                <!-- Progress Bar Section -->
                <div class="mt-4">
                    <div class="flex items-center justify-between text-xs mb-1">
                        <span class="font-semibold text-slate-700">Workshop Progress:</span>
                        <span class="font-bold text-google-blue font-mono">${p.completed_count} / 10 <span class="text-slate-400 font-normal">(${pct}%)</span></span>
                    </div>
                    <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div class="h-2 rounded-full ${p.completed_count >= 10 ? 'bg-amber-500' : p.completed_count >= 5 ? 'bg-indigo-600' : 'bg-google-blue'} smooth-progress" style="width: ${pct}%"></div>
                    </div>
                </div>

                <!-- 10 Badges Mini Matrix Dots -->
                <div class="mt-3.5 pt-3 border-t border-slate-100">
                    <div class="text-[10px] text-slate-400 uppercase font-semibold mb-1.5 flex items-center justify-between">
                        <span>10 Workshop Badges Checklist</span>
                        ${p.extra_badges_count > 0 ? `<span class="text-slate-400 lowercase text-[10px]">+${p.extra_badges_count} other badges</span>` : ''}
                    </div>
                    <div class="flex items-center justify-between gap-1">
                        ${badgeDotsHtml}
                    </div>
                </div>
            </div>

            <!-- Bottom Actions -->
            <div class="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                <!-- Profile Link -->
                <a href="${p.profile_url}" target="_blank" class="inline-flex items-center gap-1 text-[11px] text-slate-600 hover:text-google-blue font-medium transition-colors">
                    <i data-lucide="external-link" class="w-3 h-3 text-slate-400"></i>
                    <span>Profile</span>
                </a>

                <div class="flex items-center gap-1.5">
                    <!-- Live Single Sync Button -->
                    <button onclick="syncSingleParticipant(${p.id}, event)" id="btn-sync-${p.id}" title="Live scrape this participant now" class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 transition-all">
                        <i data-lucide="refresh-cw" class="w-3 h-3 text-slate-500"></i>
                        <span>Live Sync</span>
                    </button>

                    <!-- Details Modal Button -->
                    <button onclick="openParticipantModal(${p.id})" class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-blue-50 hover:bg-blue-100 text-google-blue transition-all">
                        <span>Details</span>
                        <i data-lucide="chevron-right" class="w-3 h-3"></i>
                    </button>
                </div>
            </div>
        </div>
    `;
}

// Render Table Row for Matrix View
function renderTableRow(p) {
    const completedSet = new Set((p.completed_badges_list || []).map(b => b.trim().toLowerCase()));
    const pct = Math.round((p.completed_count / 10) * 100);

    let badgeCols = '';
    for (let i = 0; i < 10; i++) {
        const tb = state.targetBadges[i];
        if (!tb) {
            badgeCols += '<td class="py-2.5 px-3 text-center text-slate-300">-</td>';
            continue;
        }
        const isDone = completedSet.has(tb.normalized_name);
        badgeCols += `
            <td class="py-2.5 px-3 text-center">
                <span class="has-tooltip inline-block">
                    <span class="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
                        isDone ? 'bg-emerald-100 text-emerald-700' : 'text-slate-300'
                    }">
                        ${isDone ? '✓' : '·'}
                    </span>
                    <span class="tooltip-content">${escapeHtml(tb.name)}<br>${isDone ? 'Completed' : 'Pending'}</span>
                </span>
            </td>
        `;
    }

    return `
        <tr class="hover:bg-slate-50 transition-colors">
            <td class="py-3 px-4">
                <div class="font-bold text-slate-900">${escapeHtml(p.user_name)}</div>
                <div class="text-[11px] text-slate-400 font-mono">${escapeHtml(p.user_email)}</div>
            </td>
            <td class="py-3 px-3">
                <div class="font-bold font-mono text-slate-800">${p.completed_count}/10 <span class="text-[10px] text-slate-400 font-normal">(${pct}%)</span></div>
            </td>
            <td class="py-3 px-3">
                ${getMilestoneBadgeHtml(p.completed_count)}
            </td>
            ${badgeCols}
            <td class="py-3 px-4 text-right">
                <div class="flex items-center justify-end gap-1.5">
                    <button onclick="syncSingleParticipant(${p.id}, event)" title="Live sync" class="p-1 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-200">
                        <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
                    </button>
                    <button onclick="openParticipantModal(${p.id})" class="p-1 rounded text-google-blue hover:bg-blue-50">
                        <i data-lucide="eye" class="w-3.5 h-3.5"></i>
                    </button>
                </div>
            </td>
        </tr>
    `;
}

// Open Participant Modal
async function openParticipantModal(id) {
    state.currentModalParticipantId = id;
    const modal = document.getElementById('participantModal');
    modal.classList.remove('hidden');

    try {
        const resp = await fetch(`/api/participants/${id}`);
        const data = await resp.json();
        if (data.status === 'success') {
            renderModalContent(data.participant);
        }
    } catch (e) {
        console.error('Error fetching participant details:', e);
    }
}

// Render Modal Content
function renderModalContent(p) {
    document.getElementById('modalUserName').textContent = p.user_name;
    document.getElementById('modalUserEmail').textContent = p.user_email;
    document.getElementById('modalAvatar').textContent = getInitials(p.user_name);
    document.getElementById('modalAccessCode').textContent = p.access_code || 'Not specified';
    document.getElementById('modalLastScraped').textContent = p.last_scraped_at || 'Not scraped yet';
    document.getElementById('modalProfileLink').href = p.profile_url;

    const count = p.completed_count || 0;
    const pct = Math.round((count / 10) * 100);
    document.getElementById('modalBadgeCount').textContent = `${count} / 10`;
    document.getElementById('modalBadgeProgressText').textContent = `${pct}% Complete`;
    document.getElementById('modalProgressBar').style.width = `${pct}%`;

    // Milestone Badge
    const mContainer = document.getElementById('modalMilestoneBadge');
    mContainer.innerHTML = getMilestoneBadgeHtml(count);

    // Render 10 Target Badges Checklist
    const listContainer = document.getElementById('modalBadgeList');
    listContainer.innerHTML = (p.badge_checklist || []).map(b => {
        return `
            <div class="flex items-center justify-between p-3 rounded-xl border ${b.is_completed ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200/80 bg-white'} shadow-2xs">
                <div class="flex items-start gap-2.5 min-w-0 pr-3">
                    <div class="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold ${
                        b.is_completed ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400 border border-slate-200'
                    }">
                        ${b.is_completed ? '✓' : b.badge_order}
                    </div>
                    <div class="min-w-0">
                        <div class="font-bold text-slate-800 text-xs leading-snug">
                            ${escapeHtml(b.name)}
                        </div>
                        <div class="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                            <span>${b.credits} Credits required</span>
                            ${b.is_completed && b.earned_date ? `<span>•</span><span class="text-emerald-700 font-medium">🗓️ ${escapeHtml(b.earned_date)}</span>` : ''}
                        </div>
                    </div>
                </div>

                <div class="shrink-0 flex items-center gap-2">
                    ${b.url ? `
                        <a href="${b.url}" target="_blank" class="text-[11px] text-google-blue hover:underline inline-flex items-center gap-0.5">
                            <span>Syllabus</span>
                            <i data-lucide="external-link" class="w-3 h-3"></i>
                        </a>
                    ` : ''}
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
                        b.is_completed ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'
                    }">
                        ${b.is_completed ? 'Completed' : 'Pending'}
                    </span>
                </div>
            </div>
        `;
    }).join('');

    // Extra Badges section
    const extraSec = document.getElementById('modalExtraBadgesSection');
    const extraBadges = p.extra_badges || [];
    if (extraBadges.length > 0) {
        extraSec.classList.remove('hidden');
        document.getElementById('modalExtraCount').textContent = extraBadges.length;
    } else {
        extraSec.classList.add('hidden');
    }

    lucide.createIcons();
}

function closeModal() {
    document.getElementById('participantModal').classList.add('hidden');
    state.currentModalParticipantId = null;
}

// Close modal on click outside
window.addEventListener('click', (e) => {
    const modal = document.getElementById('participantModal');
    if (e.target === modal) {
        closeModal();
    }
});

// Live Sync a Single Participant
async function syncSingleParticipant(id, event) {
    if (event) event.stopPropagation();

    const btn = document.getElementById(`btn-sync-${id}`);
    let originalHtml = '';
    if (btn) {
        originalHtml = btn.innerHTML;
        btn.innerHTML = `<i data-lucide="loader-2" class="w-3 h-3 animate-spin text-google-blue"></i><span>Syncing...</span>`;
        btn.disabled = true;
        lucide.createIcons();
    }

    try {
        const resp = await fetch(`/api/scrape/single/${id}`, { method: 'POST' });
        const data = await resp.json();
        if (data.status === 'success') {
            showToast('Success', `Updated badges for ${data.participant.user_name}`, 'success');
            // Refresh stats & participants
            fetchStats();
            fetchTargetBadges();
            fetchParticipants();
        } else {
            showToast('Error', data.message || 'Failed to sync profile', 'error');
        }
    } catch (e) {
        console.error('Error syncing single participant:', e);
        showToast('Error', 'Network error during sync', 'error');
    } finally {
        if (btn) {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
            lucide.createIcons();
        }
    }
}

// Sync from inside Modal
async function syncSingleParticipantFromModal() {
    if (!state.currentModalParticipantId) return;
    const id = state.currentModalParticipantId;
    const btn = document.getElementById('modalSyncBtn');
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>Syncing Live...</span>`;
    btn.disabled = true;
    lucide.createIcons();

    try {
        const resp = await fetch(`/api/scrape/single/${id}`, { method: 'POST' });
        const data = await resp.json();
        if (data.status === 'success') {
            renderModalContent(data.participant);
            showToast('Live Updated', `Refreshed skills profile for ${data.participant.user_name}`, 'success');
            fetchStats();
            fetchTargetBadges();
            fetchParticipants();
        } else {
            showToast('Sync Error', data.message || 'Could not scrape profile', 'error');
        }
    } catch (e) {
        showToast('Error', 'Network error', 'error');
    } finally {
        btn.innerHTML = origHtml;
        btn.disabled = false;
        lucide.createIcons();
    }
}

// Trigger Background Sync (All or Active)
async function triggerSync(mode) {
    try {
        const resp = await fetch('/api/scrape/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode })
        });
        const data = await resp.json();
        if (data.status === 'success') {
            showToast('Sync Started', `Live batch sync started for ${mode === 'all' ? 'all 363 participants' : 'active learners'}`, 'info');
            startPollingSync();
        } else {
            showToast('Notice', data.message || 'Could not start sync', 'info');
        }
    } catch (e) {
        console.error('Error triggering sync:', e);
    }
}

// Stop Running Sync
async function stopSync() {
    try {
        const resp = await fetch('/api/scrape/stop', { method: 'POST' });
        const data = await resp.json();
        showToast('Stopping', 'Live sync stopping...', 'info');
    } catch (e) {
        console.error('Error stopping sync:', e);
    }
}

// Sync Status Polling
function startPollingSync() {
    if (state.syncPollTimer) clearInterval(state.syncPollTimer);
    document.getElementById('liveSyncBanner').classList.remove('hidden');
    document.getElementById('syncIndicatorPill').classList.remove('hidden');
    document.getElementById('syncIndicatorPill').classList.add('flex');
    document.getElementById('btnStopSync').classList.remove('hidden');

    state.syncPollTimer = setInterval(checkSyncStatus, 1500);
    checkSyncStatus();
}

async function checkSyncStatus() {
    try {
        const resp = await fetch('/api/scrape/status');
        const data = await resp.json();
        if (data.status === 'success') {
            const sync = data.sync_status;
            if (sync.is_running) {
                document.getElementById('liveSyncBanner').classList.remove('hidden');
                document.getElementById('syncIndicatorPill').classList.remove('hidden');
                document.getElementById('syncIndicatorPill').classList.add('flex');
                document.getElementById('btnStopSync').classList.remove('hidden');

                document.getElementById('syncCurrentName').textContent = sync.current_user || 'Scraping...';
                document.getElementById('syncProgressStats').textContent = `${sync.processed} / ${sync.total} (${sync.percentage}%)`;
                document.getElementById('syncProgressBar').style.width = `${sync.percentage}%`;
                document.getElementById('syncIndicatorText').textContent = `Live Syncing (${sync.percentage}%)...`;

                if (sync.eta_seconds > 0) {
                    document.getElementById('syncTimeEstimate').textContent = `ETA: ~${Math.ceil(sync.eta_seconds)}s remaining`;
                } else {
                    document.getElementById('syncTimeEstimate').textContent = 'Processing...';
                }
            } else {
                // Stopped or Completed
                if (state.syncPollTimer) {
                    clearInterval(state.syncPollTimer);
                    state.syncPollTimer = null;
                }
                document.getElementById('liveSyncBanner').classList.add('hidden');
                document.getElementById('syncIndicatorPill').classList.add('hidden');
                document.getElementById('syncIndicatorPill').classList.remove('flex');
                document.getElementById('btnStopSync').classList.add('hidden');

                if (sync.processed > 0 && sync.processed >= sync.total) {
                    showToast('Completed', 'Live sync of all profiles completed successfully!', 'success');
                    fetchStats();
                    fetchTargetBadges();
                    fetchParticipants();
                }
            }
        }
    } catch (e) {
        console.error('Error polling sync status:', e);
    }
}

// Milestone Filter Tabs
function setMilestoneFilter(val) {
    state.milestoneFilter = val;
    // Update active tab styles
    document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active-tab'));
    if (val === '') document.getElementById('filterTabAll').classList.add('active-tab');
    else if (val === '10') document.getElementById('filterTabM3').classList.add('active-tab');
    else if (val === 'milestone_2') document.getElementById('filterTabM2').classList.add('active-tab');
    else if (val === 'milestone_1') document.getElementById('filterTabM1').classList.add('active-tab');
    else if (val === 'in_progress') document.getElementById('filterTabInProg').classList.add('active-tab');
    else if (val === 'not_started') document.getElementById('filterTabZero').classList.add('active-tab');

    fetchParticipants();
}

function filterByMilestone(val) {
    setMilestoneFilter(val);
    window.scrollTo({ top: 380, behavior: 'smooth' });
}

// Badge Filter Toggle
function toggleBadgeFilter(normName) {
    if (state.badgeFilter === normName) {
        state.badgeFilter = '';
    } else {
        state.badgeFilter = normName;
    }
    renderTargetBadges(state.targetBadges);
    fetchParticipants();
}

// Search Handling
let searchDebounceTimer = null;
function handleSearch() {
    const val = document.getElementById('searchInput').value.trim();
    state.searchQuery = val;
    document.getElementById('clearSearchBtn').classList.toggle('hidden', val === '');

    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        fetchParticipants();
    }, 250);
}

function clearSearch() {
    document.getElementById('searchInput').value = '';
    state.searchQuery = '';
    document.getElementById('clearSearchBtn').classList.add('hidden');
    fetchParticipants();
}

// Sort Handling
function handleSortChange() {
    state.sortBy = document.getElementById('sortSelect').value;
    fetchParticipants();
}

// Switch between Card Grid and Table View
function switchView(view) {
    state.currentView = view;
    const gridView = document.getElementById('participantsGridView');
    const tableView = document.getElementById('participantsTableView');
    const gridBtn = document.getElementById('viewGridBtn');
    const tableBtn = document.getElementById('viewTableBtn');

    if (view === 'grid') {
        gridView.classList.remove('hidden');
        tableView.classList.add('hidden');
        gridBtn.classList.add('bg-white', 'text-slate-700', 'shadow-xs');
        gridBtn.classList.remove('text-slate-500');
        tableBtn.classList.remove('bg-white', 'text-slate-700', 'shadow-xs');
        tableBtn.classList.add('text-slate-500');
    } else {
        gridView.classList.add('hidden');
        tableView.classList.remove('hidden');
        tableBtn.classList.add('bg-white', 'text-slate-700', 'shadow-xs');
        tableBtn.classList.remove('text-slate-500');
        gridBtn.classList.remove('bg-white', 'text-slate-700', 'shadow-xs');
        gridBtn.classList.add('text-slate-500');
    }
    renderParticipants();
}

// Active Filter Banner Updates
function updateActiveFilterBanner() {
    const banner = document.getElementById('activeFilterBanner');
    const textEl = document.getElementById('activeFilterText');
    const hasFilter = state.badgeFilter || state.milestoneFilter || state.searchQuery;

    if (!hasFilter) {
        banner.classList.add('hidden');
        banner.classList.remove('flex');
        return;
    }

    let filterDesc = [];
    if (state.searchQuery) filterDesc.push(`matching "${state.searchQuery}"`);
    if (state.milestoneFilter) filterDesc.push(`Milestone filter: ${state.milestoneFilter}`);
    if (state.badgeFilter) {
        const badgeObj = state.targetBadges.find(b => b.normalized_name === state.badgeFilter);
        filterDesc.push(`Completed Badge: ${badgeObj ? badgeObj.name : state.badgeFilter}`);
    }

    textEl.textContent = `Showing participants ${filterDesc.join(' & ')} (${state.participants.length} found)`;
    banner.classList.remove('hidden');
    banner.classList.add('flex');
}

function resetAllFilters() {
    state.searchQuery = '';
    state.milestoneFilter = '';
    state.badgeFilter = '';
    document.getElementById('searchInput').value = '';
    document.getElementById('clearSearchBtn').classList.add('hidden');
    setMilestoneFilter('');
    renderTargetBadges(state.targetBadges);
    fetchParticipants();
}

// Toast Notifications
function showToast(title, message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    const borderColors = {
        success: 'border-emerald-500 bg-white text-slate-800',
        error: 'border-rose-500 bg-white text-slate-800',
        info: 'border-blue-500 bg-white text-slate-800'
    };

    toast.className = `p-3.5 rounded-xl border-l-4 shadow-lg flex items-start gap-3 w-80 text-xs pointer-events-auto transform translate-y-2 opacity-0 transition-all duration-300 ${borderColors[type] || borderColors.info}`;
    toast.innerHTML = `
        <div class="flex-1">
            <strong class="font-bold block text-slate-900">${escapeHtml(title)}</strong>
            <span class="text-slate-600 mt-0.5 block leading-relaxed">${escapeHtml(message)}</span>
        </div>
        <button onclick="this.parentElement.remove()" class="text-slate-400 hover:text-slate-600">×</button>
    `;

    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.remove('translate-y-2', 'opacity-0');
    }, 10);

    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-x-4');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Escape HTML for security
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function(m) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[m];
    });
}
