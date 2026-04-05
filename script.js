// ─── Dark mode ──────────────────────────────────────────────────────────────
// Apply saved theme immediately to avoid a flash of wrong mode on load
(function () {
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (saved === 'dark' || (!saved && prefersDark)) {
        document.body.classList.add('dark-mode');
    }
})();

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('darkModeBtn');
    if (!btn) return;
    // Sync icon with current state
    const update = () => {
        const dark = document.body.classList.contains('dark-mode');
        btn.querySelector('i').className = dark ? 'bi bi-sun-fill' : 'bi bi-moon-fill';
        btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    };
    update();
    btn.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
        update();
    });
});

let m3uData = [];
let selectedGroup = null;
let checkedItems = new Set();
let selectedGroupItems = [];
let renamingGroup = null;
let renamingItemIndex = null;

const fileInput = document.getElementById('fileInput');
const downloadBtn = document.getElementById('downloadBtn');
const groupsList = document.getElementById('groupsList');
const itemsList = document.getElementById('itemsList');
const itemDetailsForm = document.getElementById('itemDetailsForm');
const sortItemsBtn = document.getElementById('sortItemsBtn');
const clearBtn = document.getElementById('clearBtn');

const itemGroupTitleDropdown = document.getElementById('itemGroupTitleDropdown');
const itemGroupTitleDropdownMenu = document.getElementById('itemGroupTitleDropdownMenu');
const itemGroupTitleSelected = document.getElementById('itemGroupTitleSelected');
const itemGroupTitleInput = document.getElementById('itemGroupTitle');

const itemIndexInput = document.getElementById('itemIndex');
const itemNameInput = document.getElementById('itemName');
const itemUrlInput = document.getElementById('itemUrl');
const itemTvgIdInput = document.getElementById('itemTvgId');
const itemTvgNameInput = document.getElementById('itemTvgName');
const itemTvgLogoInput = document.getElementById('itemTvgLogo');

const groupsFilterInput = document.getElementById('groupsFilterInput');
const itemsFilterInput = document.getElementById('itemsFilterInput');
let groupsFilterValue = '';
let itemsFilterValue = '';
let activeContentType = 'live'; // 'live' | 'movie' | 'series' (no 'all' — always filtered)

// Single-pass indexes — rebuilt once after load/mutation, used everywhere
let groupTypeCache = new Map();   // groupName → 'live'|'movie'|'series'
let groupItemsIndex = new Map();  // groupName → item[]  (replaces O(n) filter in renderItems)

function detectContentType(url, groupTitle) {
    const u = (url || '').toLowerCase();
    const g = (groupTitle || '').toLowerCase();

    // URL path signals — strongest indicator
    if (/\/(series|serial|episode|tvshow|tv-show|tvshows)\//i.test(u)) return 'series';
    if (/\/movie\//i.test(u)) return 'movie'; // extension alone (.mkv/.mp4) is not reliable — series use them too
    if (/\/(live|channel|livetv)\//i.test(u) || /\.(ts|m3u8)(\?|$)/.test(u)) return 'live';

    // Group title signals — series keywords
    if (/\b(series|serial|tvshow|tv show|season|episode|seasons|episodes|shows|telenovela|anime|cartoon)\b/.test(g)) return 'series';
    if (/\|\s*(series|serial|shows?|seasons?|episodes?)\b/.test(g)) return 'series';
    if (/\b(series|serial|show|season|episode|tvshow)\b/.test(g)) return 'series';

    // Group title signals — movie keywords
    if (/\b(movie|movies|film|films|vod|cinema|4k movie|hd movie)\b/.test(g)) return 'movie';
    if (/\|\s*(movies?|films?|vod|cinema)\b/.test(g)) return 'movie';

    return 'live';
}

// Refine group classifications by sampling actual channel URLs and names.
// Runs after the initial per-channel detectContentType pass.
// Fixes two common false positives:
//   1. Live groups misclassified as Movie because of keywords in group name
//      (e.g. "Film 4", "BFI Films") — URL sampling overrides the keyword signal
//   2. Ambiguous groups ('live' default) that are actually Series
//      — detected via S01E01 / Season X patterns in channel names
function reclassifySeriesGroups() {
    const SE_PATTERN   = /\bs\d{1,2}\s*e\d{1,3}\b|\bseason\s*\d+|\bepisode\s*\d+|\b\d+x\d+\b/i;
    const LIVE_URL     = /\.(ts|m3u8)(\?|$)|\/(live|channel|livetv)\//i;
    const VOD_URL      = /\/(movie|series|serial|vod)\//i;

    for (const [g, type] of groupTypeCache) {
        const items  = groupItemsIndex.get(g) || [];
        const sample = items.slice(0, 5);
        if (sample.length === 0) continue;

        if (type === 'movie') {
            // If keyword said 'movie' but URLs look like live streams → fix it
            const liveUrlCount = sample.filter(i => LIVE_URL.test(i.url || '')).length;
            if (liveUrlCount >= Math.ceil(sample.length / 2)) {
                groupTypeCache.set(g, 'live');
            }
        } else if (type === 'live') {
            // Check if URLs actually point to VOD paths → could be movie or series
            const vodUrlCount = sample.filter(i => VOD_URL.test(i.url || '')).length;
            if (vodUrlCount >= Math.ceil(sample.length / 2)) {
                // VOD — check channel names for episode patterns to decide movie vs series
                const looksLikeSeries = sample.some(i => SE_PATTERN.test(i.name || ''));
                groupTypeCache.set(g, looksLikeSeries ? 'series' : 'movie');
            } else {
                // No VOD URL signal — check channel names for episode patterns
                const looksLikeSeries = sample.some(i => SE_PATTERN.test(i.name || ''));
                if (looksLikeSeries) groupTypeCache.set(g, 'series');
            }
        }
        // type === 'series' — trust the keyword/URL detection, no override needed
    }
}

// Persisted content-type assignments — set once on file load, survive all mutations.
// This prevents sort/delete/reorder from triggering a positional re-sweep that would
// misclassify groups (e.g. Movies tab disappearing after sorting).
let _persistentGroupTypes = new Map();

// One pass over m3uData builds groupTypeCache, groupItemsIndex, and _groupCountsCache.
// Uses _persistentGroupTypes so reordering never scrambles the tab assignments.
// reclassifySeriesGroups() is intentionally NOT called here — only called on fresh load.
function buildAllIndexes() {
    groupTypeCache.clear();
    groupItemsIndex.clear();
    _groupCountsCache = new Map();

    for (const item of m3uData) {
        const g = item.groupTitle || 'No Group';

        if (!groupItemsIndex.has(g)) {
            groupItemsIndex.set(g, []);
            // Use the persisted type if we have one; otherwise detect fresh (new groups)
            groupTypeCache.set(g, _persistentGroupTypes.get(g) ?? detectContentType(item.url, g));
        }
        groupItemsIndex.get(g).push(item);
        _groupCountsCache.set(g, (_groupCountsCache.get(g) || 0) + 1);
    }
}

function getGroupContentType(groupTitle) {
    return groupTypeCache.get(groupTitle) || 'live';
}
function renderContentTypeTabs() {
    const container = document.getElementById('groupsList').parentElement;
    let tabBar = document.getElementById('contentTypeTabs');

    // Count items per type
    const counts = { all: m3uData.length, live: 0, movie: 0, series: 0 };
    groupTypeCache.forEach((type) => {
        if (counts[type] !== undefined) counts[type]++;
    });
    const typesUsed = ['live', 'movie', 'series'].filter(t => counts[t] > 0);

    // Hide tabs if only one type is present
    if (typesUsed.length <= 1) {
        if (tabBar) tabBar.remove();
        return;
    }

    // Auto-switch to first available type if current selection has no groups
    if (!typesUsed.includes(activeContentType)) {
        activeContentType = typesUsed[0];
    }

    if (!tabBar) {
        tabBar = document.createElement('div');
        tabBar.id = 'contentTypeTabs';
        tabBar.style.cssText = 'display:flex;gap:4px;padding:6px 0 4px 0;flex-wrap:wrap;';
        const filterWrapper = document.getElementById('groupsFilterInput').parentElement;
        container.insertBefore(tabBar, filterWrapper);
    }

    const tabs = [
        { id: 'live',   label: '📡 Live' },
        { id: 'movie',  label: '🎬 Movies' },
        { id: 'series', label: '📺 Series' },
    ];

    tabBar.innerHTML = '';
    tabs.forEach(({ id, label }) => {
        if (counts[id] === 0) return; // skip empty types
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm ' + (activeContentType === id ? 'btn-primary' : 'btn-outline-secondary');
        btn.textContent = `${label} (${counts[id]})`;
        btn.onclick = () => {
            activeContentType = id;
            selectedGroup = null;
            checkedItems.clear();
            itemsList.innerHTML = '';
            itemDetailsForm.reset();
            renderContentTypeTabs();
            renderGroups();
        };
        tabBar.appendChild(btn);
    });
}

groupsFilterInput.addEventListener('input', (e) => {
    groupsFilterValue = e.target.value.toLowerCase();
    renderGroups();
});
itemsFilterInput.addEventListener('input', (e) => {
    itemsFilterValue = e.target.value.toLowerCase();
    renderItems();
});

// ── Multi-drag floating preview ───────────────────────────────────────────
// When the user drags a group that is part of a multi-selection, we:
//   1. Suppress the browser's built-in drag ghost (invisible 1×1 image)
//   2. Show a custom floating card listing the selected groups
//   3. Track cursor via `dragover` (HTML5 DnD) + `drag` on the element
// This gives a Google-Drive-like "all items moving together" visual.
let _mdPreview = null;
let _mdMoveHandler = null;

function _buildMultiDragPreview(names) {
    const dark = document.body.classList.contains('dark-mode');
    const div = document.createElement('div');
    div.style.cssText = [
        'position:fixed', 'z-index:10000', 'pointer-events:none',
        'top:0', 'left:0',
        'min-width:160px', 'max-width:280px',
        `background:${dark ? '#161b22' : '#fff'}`,
        `border:1.5px solid ${dark ? '#388bfd' : '#0d6efd'}`,
        `color:${dark ? '#e6edf3' : '#212529'}`,
        'border-radius:8px', 'padding:8px 12px',
        'font-size:12.5px',
        'box-shadow:0 6px 20px rgba(0,0,0,0.28)',
        'line-height:1.7',
    ].join(';');
    const nameArr = [...names];
    const show = Math.min(5, nameArr.length);
    for (let i = 0; i < show; i++) {
        const row = document.createElement('div');
        row.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        row.textContent = '📁 ' + nameArr[i];
        div.appendChild(row);
    }
    if (nameArr.length > show) {
        const more = document.createElement('div');
        more.style.cssText = 'opacity:0.6;font-size:11px;margin-top:3px;';
        more.textContent = `+${nameArr.length - show} more`;
        div.appendChild(more);
    }
    return div;
}

function _startMultiDragPreview(evt, names) {
    // Hide browser's native drag ghost with a transparent 1×1 GIF
    const blank = new Image();
    blank.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    const ne = evt.originalEvent;
    if (ne && ne.dataTransfer) ne.dataTransfer.setDragImage(blank, 0, 0);

    _mdPreview = _buildMultiDragPreview(names);
    document.body.appendChild(_mdPreview);

    _mdMoveHandler = (e) => {
        if (!_mdPreview) return;
        const x = e.clientX, y = e.clientY;
        if (x || y) {   // ignore the 0,0 ghost event at drag end
            _mdPreview.style.left = (x + 14) + 'px';
            _mdPreview.style.top  = (y + 14) + 'px';
        }
    };
    // dragover fires everywhere the cursor moves during HTML5 DnD
    document.addEventListener('dragover', _mdMoveHandler);
    // drag fires on the element itself (covers areas outside droppable zones)
    evt.item.addEventListener('drag', _mdMoveHandler);
    _mdPreview._dragItem = evt.item;
}

function _stopMultiDragPreview() {
    if (_mdPreview) {
        document.removeEventListener('dragover', _mdMoveHandler);
        if (_mdPreview._dragItem) _mdPreview._dragItem.removeEventListener('drag', _mdMoveHandler);
        _mdPreview.remove();
        _mdPreview = null;
        _mdMoveHandler = null;
    }
}

// ── Auto-scroll while dragging groups ────────────────────────────────────────
let _autoScrollRAF = null;
let _dragClientY   = 0;

function _startAutoScroll() {
    const ZONE      = 60;  // px from edge where scroll kicks in
    const MAX_SPEED = 14;  // px per frame at the very edge

    function frame() {
        const rect  = groupsList.getBoundingClientRect();
        const relY  = _dragClientY - rect.top;
        let speed   = 0;

        if (relY < ZONE) {
            // Near top edge — scroll up
            speed = -MAX_SPEED * (1 - relY / ZONE);
        } else if (relY > rect.height - ZONE) {
            // Near bottom edge — scroll down
            speed = MAX_SPEED * (1 - (rect.height - relY) / ZONE);
        }

        if (speed !== 0) groupsList.scrollTop += speed;
        _autoScrollRAF = requestAnimationFrame(frame);
    }
    _autoScrollRAF = requestAnimationFrame(frame);
}

function _stopAutoScroll() {
    if (_autoScrollRAF !== null) {
        cancelAnimationFrame(_autoScrollRAF);
        _autoScrollRAF = null;
    }
}

document.addEventListener('dragover', e => { _dragClientY = e.clientY; });

const groupsSortable = new Sortable(groupsList, {
    animation: 150,
    scroll: false,  // disable built-in scroll — we handle it manually
    onStart: function(evt) {
        const groupName = evt.item.dataset.groupName;
        if (_rangeGroups.size > 1 && _rangeGroups.has(groupName)) {
            // Multi-range drag: floating preview card + ghost other highlighted rows
            _startMultiDragPreview(evt, _rangeGroups);
            Array.from(groupsList.children).forEach(el => {
                if (el !== evt.item && _rangeGroups.has(el.dataset.groupName))
                    el.classList.add('dragging-ghost');
            });
        } else {
            // Single drag: collapse range to just this group
            _rangeGroups.clear();
            _rangeGroups.add(groupName);
            selectedGroup = groupName;
        }
        _startAutoScroll();
    },
    onEnd: function(evt) {
        _stopAutoScroll();
        _stopMultiDragPreview();
        Array.from(groupsList.children).forEach(el => el.classList.remove('dragging-ghost'));
        updateGroupsOrder(evt);
        renderGroups();
    },
    onChoose: function(evt) {
        if (window.getSelection) window.getSelection().removeAllRanges();
        else if (document.selection) document.selection.empty();
    }
});

function getGroupIndex(groupName) {
    const groups = [...new Set(m3uData.map(item => item.groupTitle || 'No Group'))];
    return groups.indexOf(groupName);
}

const itemsSortable = new Sortable(itemsList, {
    animation: 150,
    onStart: function(evt) {
        
        if (checkedItems.size > 1 && checkedItems.has(evt.oldIndex)) {
            
            evt.item.classList.add('dragging-selected');
        } else {
            
            checkedItems.clear();
            checkedItems.add(evt.oldIndex);
        }
    },
    onEnd: function(evt) {
        evt.item.classList.remove('dragging-selected');
        updateItemsOrder(evt);
        
        
        renderItems();
    },
    onChoose: function(evt) {
        
        if (window.getSelection) {
            window.getSelection().removeAllRanges();
        } else if (document.selection) {
            document.selection.empty();
        }
    }
});

fileInput.addEventListener('change', handleFileUpload);
downloadBtn.addEventListener('click', downloadM3U);
itemDetailsForm.addEventListener('submit', saveItemChanges);
sortItemsBtn.addEventListener('click', sortItemsAlphabetically);
document.getElementById('newItemBtn').addEventListener('click', createNewItem);
document.getElementById('newGroupBtn').addEventListener('click', () => {
    const groups = [...new Set(m3uData.map(item => item.groupTitle || 'No Group'))];
    let newGroupName = 'New Group';
    let suffix = 1;
    while (groups.includes(newGroupName)) {
        newGroupName = `New Group ${suffix++}`;
    }
    
    m3uData.unshift({
        name: '',
        url: '',
        tvgId: '',
        tvgName: '',
        tvgLogo: '',
        groupTitle: newGroupName,
        duration: '-1',
        attributes: {}
    });
    renamingGroup = newGroupName;
    selectedGroup = newGroupName;
    _persistentGroupTypes.set(newGroupName, activeContentType); // keep it in the current tab
    invalidateGroupCache();
    saveToLocalStorage();
    renderGroups();
});

document.getElementById('deleteGroupsBtn').addEventListener('click', deleteSelectedGroups);
document.getElementById('deleteItemsBtn').addEventListener('click', deleteSelectedItems);

// Tracks which panel the user last interacted with so arrow keys go to the right list
let activePanel = 'groups'; // 'groups' | 'items'
groupsList.addEventListener('mousedown', () => { activePanel = 'groups'; });
itemsList.addEventListener('mousedown',  () => { activePanel = 'items'; });

// Anchor+cursor model for Shift+Arrow range selection.
// _selAnchor = the fixed starting point (set on plain navigation or plain click).
// _selCursor = the moving end (set on each Shift+Arrow press).
// The highlighted range is always min(anchor,cursor)..max(anchor,cursor).
// Pressing Shift+Arrow toward the anchor shrinks; away from it extends.
let _selAnchorGroup  = null; // group name — anchor for Shift+Arrow in groups panel
let _selCursorGroup  = null; // group name — cursor
let _selAnchorItem   = -1;   // index     — anchor for Shift+Arrow in items panel
let _selCursorItem   = -1;   // index     — cursor

// Visual range selection (Shift+Arrow) — does NOT affect checkboxes (checkedItems).
// Space then checks/unchecks everything in this range.
let _rangeGroups = new Set();

document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA';
    if (inInput) return;

    // ── Space: toggle checkbox of the currently active group ────────────────
    if (e.key === ' ' && activePanel === 'groups' && selectedGroup) {
        e.preventDefault(); // stop page scroll
        // If a Shift+Arrow range is active, Space checks/unchecks all groups in it.
        // Otherwise just toggle the active group.
        const targets = _rangeGroups.size > 0 ? _rangeGroups : new Set([selectedGroup]);
        // Decide: if every target is already checked → uncheck all; otherwise check all.
        const allChecked = [...targets].every(g => checkedItems.has(g));
        targets.forEach(g => {
            if (allChecked) checkedItems.delete(g);
            else checkedItems.add(g);
        });
        syncGroupCheckboxes();
        updateDeleteButtonsState();
        return;
    }

    // ── Enter: start renaming the active group ──────────────────────────────
    if (e.key === 'Enter' && activePanel === 'groups' && selectedGroup && !renamingGroup) {
        e.preventDefault();
        renamingGroup = selectedGroup;
        renderGroups();
        return;
    }

    // ── Arrow navigation ────────────────────────────────────────────────────
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') {
        // ── Delete / Backspace ────────────────────────────────────────────
        if (e.key !== 'Backspace' && e.key !== 'Delete') return;
        e.preventDefault();
        if (selectedGroup && checkedItems.size > 0 && typeof [...checkedItems][0] === 'number') {
            deleteSelectedItems();
        } else if (_rangeGroups.size > 0 || selectedGroup) {
            deleteSelectedGroups(false);
        }
        return;
    }

    e.preventDefault(); // stop the page from scrolling
    const down = e.key === 'ArrowDown';

    // ── Groups panel ────────────────────────────────────────────────────────
    if (activePanel === 'groups') {
        const rows = Array.from(groupsList.children).filter(el => el.dataset.groupName);
        if (rows.length === 0) return;

        if (e.shiftKey) {
            // ── Shift+Arrow: extend or shrink the highlighted range ──────────
            // Anchor stays fixed; cursor moves.
            const anchorIdx = rows.findIndex(el => el.dataset.groupName === _selAnchorGroup);
            const cursorIdx = rows.findIndex(el => el.dataset.groupName === _selCursorGroup);
            const safeAnchor = anchorIdx < 0
                ? rows.findIndex(el => el.dataset.groupName === selectedGroup)
                : anchorIdx;

            const newCursorIdx = down
                ? Math.min(Math.max(cursorIdx, 0) + 1, rows.length - 1)
                : Math.max(Math.min(cursorIdx, rows.length - 1) - 1, 0);
            if (newCursorIdx === cursorIdx && cursorIdx >= 0) return;

            _selCursorGroup = rows[newCursorIdx].dataset.groupName;

            // Highlight the range between anchor and cursor (visual only — no checkbox change)
            const lo = Math.min(safeAnchor, newCursorIdx);
            const hi = Math.max(safeAnchor, newCursorIdx);
            _rangeGroups.clear();
            for (let i = lo; i <= hi; i++) {
                const n = rows[i]?.dataset.groupName;
                if (n) _rangeGroups.add(n);
            }
            rows.forEach((el, i) => {
                el.classList.toggle('highlighted', _rangeGroups.has(el.dataset.groupName));
                el.classList.toggle('active', i === safeAnchor);
            });
            // checkedItems (checkboxes) are NOT touched — user presses Space to check the range
            rows[newCursorIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });

        } else {
            // ── Plain Arrow: just navigate, no selection change ──────────────
            const curIdx = rows.findIndex(el => el.dataset.groupName === selectedGroup);
            const nextIdx = down
                ? Math.min(curIdx + 1, rows.length - 1)
                : Math.max(curIdx - 1, 0);
            if (nextIdx === curIdx) return;

            const nextName = rows[nextIdx].dataset.groupName;
            // Activate next group (show its channels) — clear range, don't touch checkboxes
            selectedGroup = nextName;
            _rangeGroups.clear();
            rows.forEach((el, i) => {
                el.classList.toggle('active', i === nextIdx);
                el.classList.remove('highlighted');
            });
            renderItems();

            // Reset anchor+cursor so the next Shift+Arrow starts from here
            _selAnchorGroup = nextName;
            _selCursorGroup = nextName;
            rows[nextIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }

    // ── Items panel ─────────────────────────────────────────────────────────
    } else if (activePanel === 'items' && selectedGroup) {
        const total = selectedGroupItems.length;
        if (total === 0) return;

        if (e.shiftKey) {
            // ── Shift+Arrow: anchor+cursor range ─────────────────────────────
            const anchor = _selAnchorItem >= 0 ? _selAnchorItem : 0;
            const cursor = _selCursorItem >= 0 ? _selCursorItem : anchor;
            const newCursor = down
                ? Math.min(cursor + 1, total - 1)
                : Math.max(cursor - 1, 0);
            if (newCursor === cursor) return;

            _selCursorItem = newCursor;
            const lo = Math.min(anchor, newCursor);
            const hi = Math.max(anchor, newCursor);
            checkedItems.clear();
            for (let i = lo; i <= hi; i++) checkedItems.add(i);
            renderItems();
            const el = itemsList.children[newCursor];
            if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

        } else {
            // ── Plain Arrow: just navigate, no selection change ──────────────
            const nums = [...checkedItems].filter(x => typeof x === 'number');
            const cur = nums.length > 0 ? nums[nums.length - 1] : -1;
            const next = down ? Math.min(cur + 1, total - 1) : Math.max(cur - 1, 0);
            if (next === cur || next < 0) return;

            // Move the single "cursor" item without checking anything
            checkedItems.clear();
            checkedItems.add(next);
            renderItems();

            // Reset anchor+cursor
            _selAnchorItem = next;
            _selCursorItem = next;
            const el = itemsList.children[next];
            if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }
});
document.getElementById('sortGroupsBtn').addEventListener('click', sortGroupsAlphabetically);
document.getElementById('moveGroupUpBtn').addEventListener('click', () => moveSelectedGroups('up'));
document.getElementById('moveGroupDownBtn').addEventListener('click', () => moveSelectedGroups('down'));
document.getElementById('selectAllGroupsBtn').addEventListener('click', selectAllGroups);
document.getElementById('undoBtn').addEventListener('click', performUndo);
document.getElementById('settingsBtn').addEventListener('click', () => {
    const panel = document.getElementById('settingsPanel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
});
initSettings();
clearBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all data? This cannot be undone.')) {
        localStorage.clear();
        location.reload();
    }
});

const moveItemsBtn = document.getElementById('moveItemsBtn');
const groupDropdown = document.getElementById('groupDropdown');

function updateItemsOrder(evt) {
    if (!selectedGroup) return;
    const from = evt.oldIndex;
    const to   = evt.newIndex;
    if (from === to) return;

    // selectedGroupItems is the currently visible (possibly filtered) list.
    // We identify the moved item by reference, then map to the full group list.
    const movedItem = selectedGroupItems[from];
    pushUndo(m3uData.slice(), selectedGroup, `Move "${movedItem?.name || 'channel'}" in "${selectedGroup}"`);
    updateUndoButton();
    if (!movedItem) return;

    const fullGroupItems = groupItemsIndex.get(selectedGroup);
    if (!fullGroupItems || fullGroupItems.length === 0) return;

    // Find the group's starting position in m3uData (items are stored contiguously)
    let startIdx = -1;
    for (let i = 0; i < m3uData.length; i++) {
        if (m3uData[i] === fullGroupItems[0]) { startIdx = i; break; }
    }
    if (startIdx === -1) return;

    if (!itemsFilterValue) {
        // No filter: selectedGroupItems === fullGroupItems — simple splice reorder
        const newOrder = [...fullGroupItems];
        const [moved] = newOrder.splice(from, 1);
        newOrder.splice(to, 0, moved);
        for (let i = 0; i < newOrder.length; i++) m3uData[startIdx + i] = newOrder[i];
    } else {
        // Filter active: map visible from/to indices to their positions in the full list
        const fullFrom = fullGroupItems.indexOf(movedItem);
        const targetItem = selectedGroupItems[to];
        const fullTo = targetItem ? fullGroupItems.indexOf(targetItem) : fullGroupItems.length - 1;
        if (fullFrom === -1 || fullTo === -1) return;

        const newOrder = [...fullGroupItems];
        const [moved] = newOrder.splice(fullFrom, 1);
        newOrder.splice(fullTo, 0, moved);
        for (let i = 0; i < newOrder.length; i++) m3uData[startIdx + i] = newOrder[i];
    }

    checkedItems.clear();
    checkedItems.add(to);

    invalidateGroupCache();
    saveToLocalStorage();
    // renderItems() is called by the itemsSortable onEnd handler
}

function updateGroupDropdown() {
    // Use cached group list — no m3uData scan
    const groups = [...getGroupCounts().keys()];
    const fragment = document.createDocumentFragment();

    groups.forEach(group => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.className = 'dropdown-item';
        a.href = '#';
        a.textContent = group;
        a.addEventListener('click', (e) => {
            e.preventDefault();
            moveSelectedItemsToGroup(group);
        });
        li.appendChild(a);
        fragment.appendChild(li);
    });

    groupDropdown.innerHTML = '';
    groupDropdown.appendChild(fragment);
    moveItemsBtn.disabled = checkedItems.size === 0 || groups.length === 0;
}


function moveSelectedItemsToGroup(targetGroup) {
    if (checkedItems.size === 0 || !selectedGroup) return;

    
    
    const selectedItemIndices = Array.from(checkedItems);
    const itemsToMove = selectedItemIndices.map(index => selectedGroupItems[index]).filter(Boolean);

    
    itemsToMove.forEach(item => {
        item.groupTitle = targetGroup;
    });

    
    checkedItems.clear();

    invalidateGroupCache();
    saveToLocalStorage();
    renderGroups();
    renderItems();
    updateDeleteButtonsState();

    
    alert(`Moved ${itemsToMove.length} item(s) to "${targetGroup}"`);
}

function createNewItem() {
    if (!selectedGroup) {
        alert('Please select a group first');
        return;
    }
    
    
    const newItem = {
        name: 'New Item',
        url: '',
        tvgId: '',
        tvgName: '',
        tvgLogo: '',
        groupTitle: selectedGroup,
        duration: '-1',
        attributes: {}
    };
    
    
    m3uData.unshift(newItem);

    invalidateGroupCache();
    saveToLocalStorage();
    renderItems();
    
    
    selectItem({}, 0);
    
    
    setTimeout(() => {
        document.getElementById('itemName').focus();
        document.getElementById('itemName').select();
    }, 100);
}

function updateDeleteButtonsState() {
    const hasChecked    = checkedItems.size > 0;
    const hasWorkingSet = _rangeGroups.size > 0 || !!selectedGroup;
    document.getElementById('deleteGroupsBtn').disabled = !hasChecked;
    document.getElementById('deleteItemsBtn').disabled  = !hasChecked || !selectedGroup;
    moveItemsBtn.disabled = !hasChecked || !selectedGroup || groupDropdown.children.length === 0;
    document.getElementById('moveGroupUpBtn').disabled   = !hasWorkingSet;
    document.getElementById('moveGroupDownBtn').disabled = !hasWorkingSet;
}

// ── Undo stack ────────────────────────────────────────────────────────────────

const MAX_UNDO = 5;
let undoStack = []; // { snapshot, prevSelectedGroup, description }

function pushUndo(snapshot, prevSelectedGroup, description) {
    undoStack.push({ snapshot, prevSelectedGroup, description });
    if (undoStack.length > MAX_UNDO) undoStack.shift(); // drop oldest when full
}

function updateUndoButton() {
    const btn = document.getElementById('undoBtn');
    if (!btn) return;
    const n = undoStack.length;
    btn.disabled = n === 0;
    btn.title = n > 0
        ? `Undo (${n} action${n !== 1 ? 's' : ''} available)`
        : 'Nothing to undo';
    // Solid + bold when active, muted outline when nothing to undo
    btn.className = n > 0
        ? 'btn btn-warning fw-semibold'
        : 'btn btn-outline-secondary';
}

function performUndo() {
    if (undoStack.length === 0) return;
    const { snapshot, prevSelectedGroup, description } = undoStack.pop();
    m3uData = snapshot;
    selectedGroup = prevSelectedGroup;
    invalidateGroupCache();
    renderGroups();
    saveToLocalStorage();
    updateUndoButton();
    showToast(`↩ Undone: ${description}`);
}

// ── Toast notifications ────────────────────────────────────────────────────────

let _dismissCurrentToast = null;

// Info-only toast — auto-dismisses after `duration` ms, click to dismiss early.
// Undo is handled by the permanent ↩ Undo button in the toolbar.
function showToast(message, duration = 3000) {
    if (_dismissCurrentToast) { _dismissCurrentToast(); _dismissCurrentToast = null; }

    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'm3u-toast d-flex align-items-center gap-2 mb-0 shadow py-2 px-3 rounded';
    toast.style.cssText = 'min-width:260px;max-width:480px;pointer-events:all;cursor:pointer;';
    toast.title = 'Click to dismiss';

    const msg = document.createElement('span');
    msg.textContent = message;
    toast.appendChild(msg);

    const fadeOut = () => {
        toast.style.transition = 'opacity .4s';
        toast.style.opacity = '0';
        setTimeout(() => { if (toast.parentNode) container.removeChild(toast); }, 400);
        if (_dismissCurrentToast === fadeOut) _dismissCurrentToast = null;
    };
    _dismissCurrentToast = fadeOut;

    toast.onclick = () => { clearTimeout(timer); fadeOut(); };
    container.appendChild(toast);
    const timer = setTimeout(fadeOut, duration);
}

function deleteSelectedGroups(useChecked = true) {
    // Button path: checked items → range → active group
    // Keyboard path (useChecked=false): range → active group only
    const deleteSet = (useChecked && checkedItems.size > 0) ? checkedItems
                    : _rangeGroups.size > 0  ? _rangeGroups
                    : selectedGroup          ? new Set([selectedGroup])
                    : new Set();
    if (deleteSet.size === 0) return;

    const groupsToDelete = new Set(deleteSet);
    const groupCount = groupsToDelete.size;

    // Count channels in the groups being deleted (indexes must be ready)
    getGroupCounts();
    const channelCount = [...groupsToDelete].reduce((sum, g) => sum + (groupItemsIndex.get(g) || []).length, 0);

    if (localStorage.getItem('setting_confirmDelete') === 'true') {
        if (!confirm(`Delete ${groupCount} group(s) and ${channelCount} channel(s)?`)) return;
    }

    const description = `${groupCount} group${groupCount !== 1 ? 's' : ''} · ${channelCount} channel${channelCount !== 1 ? 's' : ''}`;
    pushUndo(m3uData.slice(), selectedGroup, description);
    updateUndoButton();

    // Find the first surviving group after the deleted block so the cursor
    // lands there instead of jumping to the top of the list.
    const visibleBefore = [...getGroupCounts().keys()]
        .filter(g => getGroupContentType(g) === activeContentType)
        .filter(g => !groupsFilterValue || g.toLowerCase().includes(groupsFilterValue));
    const firstDeletedIdx = visibleBefore.findIndex(g => groupsToDelete.has(g));
    const nextGroup = firstDeletedIdx >= 0
        ? visibleBefore.slice(firstDeletedIdx).find(g => !groupsToDelete.has(g)) || // first after block
          visibleBefore.slice(0, firstDeletedIdx).reverse().find(g => !groupsToDelete.has(g)) || // last before block
          null
        : null;

    m3uData = m3uData.filter(item => !groupsToDelete.has(item.groupTitle || 'No Group'));
    if (useChecked && checkedItems.size > 0) checkedItems.clear();
    _rangeGroups.clear();
    // Set selectedGroup to the landing target BEFORE renderGroups so the
    // auto-select-first-group block doesn't fire and wipe checkedItems.
    selectedGroup = nextGroup || null;

    invalidateGroupCache();
    renderGroups();

    if (nextGroup) {
        renderItems(); // load channels for the newly selected group
    } else {
        itemsList.innerHTML = '';
        itemDetailsForm.reset();
    }

    saveToLocalStorage();
    updateDeleteButtonsState();

    showToast(`Deleted ${description}`);
}

function deleteSelectedItems() {
    if (checkedItems.size === 0 || !selectedGroup) return;

    const indicesToDelete = Array.from(checkedItems).sort((a, b) => b - a);
    const groupItems = groupItemsIndex.get(selectedGroup) || [];
    const deleteCount = indicesToDelete.filter(i => groupItems[i]).length;

    if (localStorage.getItem('setting_confirmDelete') === 'true') {
        if (!confirm(`Delete ${deleteCount} channel(s) from "${selectedGroup}"?`)) return;
    }

    const description = `${deleteCount} channel${deleteCount !== 1 ? 's' : ''} from "${selectedGroup}"`;
    pushUndo(m3uData.slice(), selectedGroup, description);
    updateUndoButton();

    indicesToDelete.forEach(index => {
        const itemToDelete = groupItems[index];
        if (itemToDelete) {
            const itemIndex = m3uData.findIndex(item => item === itemToDelete);
            if (itemIndex !== -1) m3uData.splice(itemIndex, 1);
        }
    });

    checkedItems.clear();
    invalidateGroupCache();
    renderItems();
    itemDetailsForm.reset();
    saveToLocalStorage();
    updateDeleteButtonsState();

    showToast(`Deleted ${description}`);
}

function showLoading(msg, pct) {
    let el = document.getElementById('loadingOverlay');
    if (!el) {
        el = document.createElement('div');
        el.id = 'loadingOverlay';
        el.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(255,255,255,0.92);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;';
        el.innerHTML = `
            <div id="loadingMsg" style="font-size:1.1em;font-weight:500;margin-bottom:14px;"></div>
            <div style="width:320px;background:#e9ecef;border-radius:8px;height:12px;overflow:hidden;">
                <div id="loadingBar" style="height:100%;width:0%;background:#0d6efd;border-radius:8px;transition:width 0.1s;"></div>
            </div>
            <div id="loadingPct" style="margin-top:8px;font-size:0.9em;color:#666;"></div>`;
        document.body.appendChild(el);
    }
    document.getElementById('loadingMsg').textContent = msg;
    if (pct !== undefined) {
        document.getElementById('loadingBar').style.width = pct + '%';
        document.getElementById('loadingPct').textContent = Math.round(pct) + '%';
    }
}

function hideLoading() {
    const el = document.getElementById('loadingOverlay');
    if (el) el.remove();
}

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    showLoading(`Reading ${file.name} (${sizeMB} MB)…`, 0);

    const reader = new FileReader();
    reader.onload = function(e) {
        const content = e.target.result;
        showLoading(`Parsing ${file.name} (${sizeMB} MB)…`, 5);
        // Yield to browser so the overlay renders, then start chunked parsing
        setTimeout(() => parseM3UChunked(content, sizeMB), 30);
    };
    reader.onerror = function() {
        hideLoading();
        alert('Error reading file.');
    };
    reader.readAsText(file);
}

const PARSE_CHUNK_SIZE = 20000; // lines per chunk

function parseM3UChunked(content, sizeMB) {
    // Reset everything
    m3uData = [];
    _groupCountsCache = new Map();
    groupTypeCache = new Map();
    groupItemsIndex = new Map();

    const lines = content.split('\n');
    const total = lines.length;
    let i = 0;
    let currentItem = null;

    function processChunk() {
        const end = Math.min(i + PARSE_CHUNK_SIZE, total);
        for (; i < end; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            if (line.startsWith('#EXTINF')) {
                currentItem = { rawExtinf: line };
                const tvgIdMatch = line.match(/tvg-id="([^"]*)"/);
                const tvgNameMatch = line.match(/tvg-name="([^"]*)"/);
                const tvgLogoMatch = line.match(/tvg-logo="([^"]*)"/);
                const groupTitleMatch = line.match(/group-title="([^"]*)"/);
                currentItem.tvgId = tvgIdMatch ? tvgIdMatch[1] : '';
                currentItem.tvgName = tvgNameMatch ? tvgNameMatch[1] : '';
                currentItem.tvgLogo = tvgLogoMatch ? tvgLogoMatch[1] : '';
                currentItem.groupTitle = groupTitleMatch ? groupTitleMatch[1] : 'No Group';
                // Channel name follows the last `",` (end of last quoted attribute).
                // Using plain /,(.*)$/ would match the first comma, which could be
                // inside a tvg-name like `FR| Ça va bien se passer, Dadju S01 E01`.
                const lastQuoteComma = line.lastIndexOf('",');
                currentItem.name = lastQuoteComma >= 0
                    ? line.slice(lastQuoteComma + 2).trim()
                    : (line.includes(',') ? line.slice(line.lastIndexOf(',') + 1).trim() : 'Unnamed');
            } else if (currentItem && !line.startsWith('#')) {
                currentItem.url = line.trim();
                m3uData.push(currentItem);

                // Build all three indexes inline — free, O(1) per item, no separate pass needed
                const g = currentItem.groupTitle || 'No Group';
                _groupCountsCache.set(g, (_groupCountsCache.get(g) || 0) + 1);
                if (!groupItemsIndex.has(g)) {
                    groupItemsIndex.set(g, []);
                    groupTypeCache.set(g, detectContentType(currentItem.url, g));
                }
                groupItemsIndex.get(g).push(currentItem);

                currentItem = null;
            }
        }

        const pct = 5 + Math.round((i / total) * 90); // 5–95% for parsing+indexing
        showLoading(`Parsing ${sizeMB} MB… ${m3uData.length.toLocaleString()} channels found`, pct);

        if (i < total) {
            setTimeout(processChunk, 0);
        } else {
            // Indexes already built — run series reclassification then render.
            // After sweep, snapshot types so mutations never re-trigger the sweep.
            showLoading('Detecting content types…', 96);
            setTimeout(() => {
                reclassifySeriesGroups();
                _persistentGroupTypes = new Map(groupTypeCache); // persist for all future mutations
                showLoading('Rendering…', 97);
                setTimeout(() => {
                try {
                    saveToLocalStorage();
                    renderContentTypeTabs();
                    renderGroups();
                    downloadBtn.disabled = false;
                    document.getElementById('shareBtn').disabled = false;
                } catch (err) {
                    console.error('Render error:', err);
                } finally {
                    hideLoading();
                }
                }, 0);
            }, 0);
        }
    }

    processChunk();
}

// Indexes are built during parsing or lazily rebuilt on demand after mutations
let _groupCountsCache = null;

function getGroupCounts() {
    if (_groupCountsCache === null) buildAllIndexes();
    return _groupCountsCache;
}

function invalidateGroupCache() {
    _groupCountsCache = null;
    groupTypeCache.clear();
    groupItemsIndex.clear();
}

function renderGroups() {
    const groupCounts = getGroupCounts();
    let groups = [...groupCounts.keys()];

    // Filter by content type tab (always active — no 'all' tab)
    groups = groups.filter(g => getGroupContentType(g) === activeContentType);
    if (groupsFilterValue) {
        groups = groups.filter(g => g.toLowerCase().includes(groupsFilterValue));
    }

    groupsList.innerHTML = '';

    // Build all rows into a fragment — single DOM update instead of N individual appends
    const fragment = document.createDocumentFragment();
    groups.forEach((group, idx) => {
        const groupItem = document.createElement('div');
        groupItem.className = 'list-group-item d-flex justify-content-between align-items-center';
        groupItem.dataset.groupName = group; // store raw name so selectGroup can read it reliably
        if (renamingGroup === group) {
            const input = document.createElement('input');
            input.type = 'text';
            input.value = group;
            input.className = 'form-control form-control-sm d-inline-block';
            input.style.width = '70%';
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation(); // prevent bubbling to doc-level Enter handler
                    saveGroupRename(group, input.value);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    renamingGroup = null;
                    renderGroups();
                }
            });
            const saveBtn = document.createElement('button');
            saveBtn.className = 'btn btn-sm btn-success ms-1';
            saveBtn.textContent = 'Save';
            saveBtn.onclick = () => saveGroupRename(group, input.value);
            groupItem.appendChild(input);
            groupItem.appendChild(saveBtn);
            setTimeout(() => { input.focus(); input.select(); }, 50);
        } else {
            // ── Checkbox ─────────────────────────────────────────────────
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'group-checkbox';
            checkbox.checked = checkedItems.has(group);
            checkbox.title = 'Select group';
            checkbox.addEventListener('click', (e) => {
                e.stopPropagation(); // don't trigger row single-click
                const allItems = Array.from(groupsList.children);
                const thisIdx  = allItems.findIndex(el => el.dataset.groupName === group);

                if (e.shiftKey && checkedItems.size > 0) {
                    // Shift+click: range from the active group to here
                    const anchorIdx = allItems.findIndex(el => el.classList.contains('active'));
                    const [start, end] = [Math.min(anchorIdx < 0 ? thisIdx : anchorIdx, thisIdx),
                                          Math.max(anchorIdx < 0 ? thisIdx : anchorIdx, thisIdx)];
                    checkedItems.clear();
                    for (let i = start; i <= end; i++) {
                        const n = allItems[i]?.dataset.groupName;
                        if (n) checkedItems.add(n);
                    }
                } else {
                    // Plain or Ctrl: toggle just this group
                    if (checkedItems.has(group)) checkedItems.delete(group);
                    else checkedItems.add(group);
                }
                syncGroupCheckboxes();
                updateDeleteButtonsState();
                checkbox.blur(); // return focus to document so arrow keys keep working
            });

            // ── Label area (name + count) ─────────────────────────────────
            const labelWrap = document.createElement('span');
            labelWrap.style.cssText = 'flex:1;overflow:hidden;display:flex;align-items:center;min-width:0;';

            const nameSpan = document.createElement('span');
            nameSpan.textContent = group;
            nameSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';

            const countSpan = document.createElement('span');
            countSpan.className = 'badge bg-secondary ms-2';
            countSpan.style.flexShrink = '0';
            countSpan.textContent = groupCounts.get(group) || 0;

            labelWrap.appendChild(nameSpan);
            labelWrap.appendChild(countSpan);

            groupItem.appendChild(checkbox);
            groupItem.appendChild(labelWrap);

            groupItem.addEventListener('click', (e) => {
                if (selectedGroup === group && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                    // Second click on the already-active row → toggle its check state
                    if (checkedItems.has(group)) checkedItems.delete(group);
                    else checkedItems.add(group);
                    syncGroupCheckboxes();
                    updateDeleteButtonsState();
                } else {
                    selectGroup(e, group, idx);
                }
            });
            if (checkedItems.has(group)) groupItem.classList.add('selected');
            if (_rangeGroups.has(group))  groupItem.classList.add('highlighted');
            if (selectedGroup === group)  groupItem.classList.add('active');
        }
        fragment.appendChild(groupItem);
    });
    groupsList.appendChild(fragment);
    syncGroupCheckboxes(); // keep checkboxes and "Select All" button in sync

    // Dropdowns are built lazily on demand — no need to build them on every render
    if (groups.length > 0 && !selectedGroup) {
        selectGroup(null, groups[0], 0);
        // Auto-activating the first group on load should not pre-check any box.
        // selectGroup adds it to checkedItems — clear that immediately.
        checkedItems.clear();
        syncGroupCheckboxes();
    }
}

// Sync all visible group-row checkboxes to the current checkedItems Set,
// and update the "Select All" button's state (checked / indeterminate / unchecked).
function syncGroupCheckboxes() {
    const allItems = Array.from(groupsList.children);
    let checkedCount = 0;
    allItems.forEach(el => {
        const cb = el.querySelector('.group-checkbox');
        if (!cb) return;
        const isSelected = checkedItems.has(el.dataset.groupName);
        cb.checked = isSelected;
        el.classList.toggle('selected', isSelected);
        el.classList.toggle('highlighted', _rangeGroups.has(el.dataset.groupName));
        if (isSelected) checkedCount++;
    });

    // Update "☑ All" button to reflect state
    const selectAllBtn = document.getElementById('selectAllGroupsBtn');
    if (selectAllBtn) {
        const total = allItems.filter(el => el.dataset.groupName).length;
        const icon = selectAllBtn.querySelector('i');
        if (checkedCount === 0) {
            if (icon) icon.className = 'bi bi-check2-square';
            selectAllBtn.title = 'Select all groups';
        } else if (checkedCount === total) {
            if (icon) icon.className = 'bi bi-dash-square';
            selectAllBtn.title = 'Deselect all groups';
        } else {
            if (icon) icon.className = 'bi bi-check2-square';
            selectAllBtn.title = `${checkedCount} of ${total} selected`;
        }
    }
}

function selectGroup(event, groupName, groupIdx) {
    // Use groupName directly — no split needed now that we use data-group-name attributes.
    // The old split(' (')[0] was truncating group names that contain ' (' (e.g. "HBO (US)")
    // which broke both visual selection and deletion.
    const items = Array.from(groupsList.children);
    let idx = groupIdx;
    if (typeof idx !== 'number') {
        idx = items.findIndex(item => item.dataset.groupName === groupName);
    }

    if (event && (event.ctrlKey || event.metaKey)) {
        // Ctrl+click — toggle this group in the visual range (does NOT check the checkbox)
        if (_rangeGroups.has(groupName)) {
            _rangeGroups.delete(groupName);
        } else {
            _rangeGroups.add(groupName);
        }
        selectedGroup = groupName;
        _selAnchorGroup = groupName;
        _selCursorGroup = groupName;
        items.forEach((item, i) => {
            item.classList.toggle('highlighted', _rangeGroups.has(item.dataset.groupName));
            item.classList.toggle('active', i === idx);
        });
        updateDeleteButtonsState();
        return;
    } else if (event && event.shiftKey) {
        // Shift+click — highlight a contiguous range (does NOT check any checkboxes)
        const anchorIdx = items.findIndex(item => item.classList.contains('active'));
        const safeAnchor = anchorIdx < 0 ? idx : anchorIdx;
        const [start, end] = [Math.min(safeAnchor, idx), Math.max(safeAnchor, idx)];
        _rangeGroups.clear();
        for (let i = start; i <= end; i++) {
            const n = items[i]?.dataset.groupName;
            if (n) _rangeGroups.add(n);
        }
        _selAnchorGroup = items[safeAnchor]?.dataset.groupName ?? groupName;
        _selCursorGroup = groupName;
        items.forEach((item, i) => {
            item.classList.toggle('highlighted', _rangeGroups.has(item.dataset.groupName));
            item.classList.toggle('active', i === safeAnchor);
        });
        updateDeleteButtonsState();
        return;
    }

    // Normal single click — navigate only, never touch checked state (checkedItems)
    selectedGroup = groupName;
    _rangeGroups.clear();
    _selAnchorGroup = groupName;
    _selCursorGroup = groupName;
    items.forEach((item, i) => {
        item.classList.remove('highlighted');
        item.classList.toggle('active', i === idx);
    });
    syncGroupCheckboxes(); // clears all checked visuals since checkedItems is now empty
    renderItems();
    updateDeleteButtonsState();
}

const ITEM_HEIGHT = 46; // px per row (tall enough for 36px icons with breathing room)
const VISIBLE_BUFFER = 10; // extra rows above/below viewport

function buildItemElement(item, index) {
    const itemElement = document.createElement('div');
    itemElement.className = 'list-group-item d-flex justify-content-between align-items-center';
    itemElement.style.height = ITEM_HEIGHT + 'px';
    itemElement.style.boxSizing = 'border-box';

    if (renamingItemIndex === index) {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = item.name || 'Unnamed';
        input.className = 'form-control form-control-sm d-inline-block';
        input.style.width = '70%';
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') saveItemRename(index, input.value);
        });
        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn btn-sm btn-success ms-1';
        saveBtn.textContent = 'Save';
        saveBtn.onclick = () => saveItemRename(index, input.value);
        itemElement.appendChild(input);
        itemElement.appendChild(saveBtn);
        setTimeout(() => { input.focus(); input.select(); }, 50);
    } else {
        if (settingShowIcons() && item.tvgLogo) {
            const img = document.createElement('img');
            img.src = item.tvgLogo;
            img.style.cssText = 'width:32px;height:32px;object-fit:contain;flex-shrink:0;border-radius:4px;margin-right:16px;';
            img.onerror = () => { img.style.display = 'none'; };
            itemElement.appendChild(img);
        }
        const nameSpan = document.createElement('span');
        nameSpan.textContent = item.name || 'Unnamed';
        // flex:1 fills the available space between icon and url, keeping name left-aligned.
        // Without this, justify-content-between spreads three children evenly and the name
        // ends up centred between icon and url.
        nameSpan.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        const urlSpan = document.createElement('span');
        urlSpan.className = 'text-muted ms-2';
        let url = item.url || '';
        if (url.length > 32) url = url.slice(0, 29) + '...';
        urlSpan.textContent = url;
        urlSpan.style.maxWidth = '160px';
        urlSpan.style.overflow = 'hidden';
        urlSpan.style.textOverflow = 'ellipsis';
        urlSpan.style.whiteSpace = 'nowrap';
        itemElement.appendChild(nameSpan);
        itemElement.appendChild(urlSpan);
        itemElement.dataset.index = index;
        itemElement.addEventListener('click', (e) => selectItem(e, index));
        itemElement.addEventListener('dblclick', () => {
            renamingItemIndex = index;
            renderItems();
        });
        if (checkedItems.has(index)) itemElement.classList.add('selected');
    }
    return itemElement;
}

let _virtualScrollHandler = null;

function renderItems() {
    if (!selectedGroup) {
        updateGroupDropdown();
        return;
    }

    selectedGroupItems = groupItemsIndex.get(selectedGroup) || [];
    if (itemsFilterValue) {
        selectedGroupItems = selectedGroupItems.filter(item => (item.name || '').toLowerCase().includes(itemsFilterValue));
    }

    // Remove old scroll listener
    if (_virtualScrollHandler) {
        itemsList.removeEventListener('scroll', _virtualScrollHandler);
        _virtualScrollHandler = null;
    }

    const total = selectedGroupItems.length;

    // For small groups render normally; for large groups use virtual scroll
    if (total <= 200) {
        itemsList.innerHTML = '';
        itemsList.style.position = '';
        itemsList.style.overflowY = '';
        selectedGroupItems.forEach((item, index) => {
            itemsList.appendChild(buildItemElement(item, index));
        });
        return;
    }

    // Virtual scroll setup
    const containerHeight = itemsList.clientHeight || 400;
    const totalHeight = total * ITEM_HEIGHT;

    itemsList.innerHTML = '';
    itemsList.style.position = 'relative';
    itemsList.style.overflowY = 'auto';
    itemsList.style.height = (itemsList.parentElement ? itemsList.parentElement.clientHeight || 400 : 400) + 'px';

    // Spacer div to give the correct total scroll height
    const spacer = document.createElement('div');
    spacer.style.height = totalHeight + 'px';
    spacer.style.pointerEvents = 'none';
    itemsList.appendChild(spacer);

    // Rendered rows container
    const rowsContainer = document.createElement('div');
    rowsContainer.style.position = 'absolute';
    rowsContainer.style.top = '0';
    rowsContainer.style.left = '0';
    rowsContainer.style.right = '0';
    itemsList.appendChild(rowsContainer);

    function renderVisibleRows() {
        const scrollTop = itemsList.scrollTop;
        const visibleCount = Math.ceil(containerHeight / ITEM_HEIGHT) + VISIBLE_BUFFER * 2;
        const startIdx = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - VISIBLE_BUFFER);
        const endIdx = Math.min(total - 1, startIdx + visibleCount);

        rowsContainer.innerHTML = '';
        rowsContainer.style.top = (startIdx * ITEM_HEIGHT) + 'px';

        for (let i = startIdx; i <= endIdx; i++) {
            rowsContainer.appendChild(buildItemElement(selectedGroupItems[i], i));
        }
    }

    renderVisibleRows();
    _virtualScrollHandler = renderVisibleRows;
    itemsList.addEventListener('scroll', _virtualScrollHandler);
}

function selectItem(event, index) {
    const item = selectedGroupItems[index];
    if (!item) return;
    
    if (event.ctrlKey) {
        
        const itemElement = event.target;
        itemElement.classList.toggle('selected');
        if (itemElement.classList.contains('selected')) {
            checkedItems.add(index);
        } else {
            checkedItems.delete(index);
        }
        updateDeleteButtonsState();
        return;
    } else if (event.shiftKey) {
        
        const items = Array.from(itemsList.children);
        const startIndex = items.findIndex(item => item.classList.contains('active'));
        const endIndex = index;
        
        const [start, end] = [Math.min(startIndex, endIndex), Math.max(startIndex, endIndex)];
        
        for (let i = start; i <= end; i++) {
            items[i].classList.add('selected');
            checkedItems.add(i);
        }
        updateDeleteButtonsState();
        return;
    }
    
    
    checkedItems.clear();
    checkedItems.add(index);
    
    
    Array.from(itemsList.children).forEach((el, i) => {
        el.classList.toggle('active', i === index);
        el.classList.toggle('selected', checkedItems.has(i));
    });
    
    
    itemIndexInput.value = index;
    itemNameInput.value = item.name || '';
    itemUrlInput.value = item.url || '';
    itemTvgIdInput.value = item.tvgId || '';
    itemTvgNameInput.value = item.tvgName || '';
    itemTvgLogoInput.value = item.tvgLogo || '';
    updateItemGroupTitleDropdown(item.groupTitle || '');
    updateItemUrlPreview(item.url || '');
    
    updateDeleteButtonsState();
}

function saveItemChanges(e) {
    e.preventDefault();
    
    const index = parseInt(itemIndexInput.value);
    if (isNaN(index) || index < 0 || index >= selectedGroupItems.length) return;
    
    const item = selectedGroupItems[index];
    
    
    item.name = itemNameInput.value;
    item.url = itemUrlInput.value;
    item.tvgId = itemTvgIdInput.value;
    item.tvgName = itemTvgNameInput.value;
    item.tvgLogo = itemTvgLogoInput.value;
    
    const oldGroup = item.groupTitle;
    item.groupTitle = itemGroupTitleInput.value;
    
    
    const globalIndex = m3uData.findIndex(i => i === selectedGroupItems[index]);
    if (globalIndex !== -1) {
        m3uData[globalIndex] = { ...item };
    }
    
    
    invalidateGroupCache();
    if (oldGroup !== item.groupTitle) {
        selectedGroup = item.groupTitle;
        renderGroups();
    } else {
        renderItems();
    }

    saveToLocalStorage();
}

function sortItemsAlphabetically() {
    if (!selectedGroup) return;

    const groupItems = (groupItemsIndex.get(selectedGroup) || []).slice(); // copy before sorting
    groupItems.sort((a, b) => (a.name || '').localeCompare(b.name || ''));


    m3uData = m3uData.filter(item => item.groupTitle !== selectedGroup);


    m3uData = [...m3uData, ...groupItems];

    invalidateGroupCache();
    renderItems();
    saveToLocalStorage();
}

// ── Select All groups ─────────────────────────────────────────────────────────

function selectAllGroups() {
    getGroupCounts();
    // Respect active content-type tab and search filter (same logic as renderGroups)
    let groups = [...getGroupCounts().keys()];
    groups = groups.filter(g => getGroupContentType(g) === activeContentType);
    if (groupsFilterValue) {
        groups = groups.filter(g => g.toLowerCase().includes(groupsFilterValue));
    }

    const allAlreadySelected = groups.length > 0 && groups.every(g => checkedItems.has(g));

    if (allAlreadySelected) {
        // Uncheck all
        checkedItems.clear();
        _rangeGroups.clear();
        selectedGroup = null;
        // Remove active highlight from every row
        Array.from(groupsList.children).forEach(el => el.classList.remove('active'));
        itemsList.innerHTML = '';
        itemDetailsForm.reset();
    } else {
        // Check all visible groups
        checkedItems.clear();
        groups.forEach(g => checkedItems.add(g));
        // keep selectedGroup so the channel panel stays visible
    }

    // syncGroupCheckboxes updates cb.checked, 'selected' class, 'highlighted' class,
    // AND the Select All button icon — the manual classList loop that was here before
    // was missing cb.checked updates, causing checkmark ticks to not appear.
    syncGroupCheckboxes();
    updateDeleteButtonsState();
}

// ── Settings ──────────────────────────────────────────────────────────────────

function initSettings() {
    const confirmDelete = document.getElementById('settingConfirmDelete');
    confirmDelete.checked = localStorage.getItem('setting_confirmDelete') === 'true';
    confirmDelete.addEventListener('change', () => {
        localStorage.setItem('setting_confirmDelete', confirmDelete.checked ? 'true' : 'false');
    });

    const showIcons = document.getElementById('settingShowIcons');
    showIcons.checked = localStorage.getItem('setting_showIcons') === 'true';
    showIcons.addEventListener('change', () => {
        localStorage.setItem('setting_showIcons', showIcons.checked ? 'true' : 'false');
        renderItems();
    });

    // ── Cloud provider ────────────────────────────────────────────────────────
    const savedProvider = localStorage.getItem('setting_cloudProvider') || '';
    if (savedProvider) {
        const radio = document.querySelector(`input[name="cloudProvider"][value="${savedProvider}"]`);
        if (radio) { radio.checked = true; showCloudSection(savedProvider); }
    }
    document.querySelectorAll('input[name="cloudProvider"]').forEach(r => {
        r.addEventListener('change', () => {
            localStorage.setItem('setting_cloudProvider', r.value);
            showCloudSection(r.value);
        });
    });
    initDropboxSettings();
    initGdriveSettings();
    updateCloudStatus();
}

function showCloudSection(provider) {
    document.getElementById('cloudDropbox').style.display = provider === 'dropbox' ? 'block' : 'none';
    document.getElementById('cloudGdrive').style.display  = provider === 'gdrive'  ? 'block' : 'none';
}

// ── Dropbox OAuth2 ────────────────────────────────────────────────────────────
function initDropboxSettings() {
    const appKey    = document.getElementById('dbxAppKey');
    const appSecret = document.getElementById('dbxAppSecret');
    const authBtn   = document.getElementById('dbxAuthorizeBtn');
    const codeRow   = document.getElementById('dbxCodeRow');
    const codeInput = document.getElementById('dbxCodeInput');
    const codeSubmit= document.getElementById('dbxCodeSubmit');

    appKey.value    = localStorage.getItem('dbx_appKey')    || '';
    appSecret.value = localStorage.getItem('dbx_appSecret') || '';

    appKey.addEventListener('change',    () => localStorage.setItem('dbx_appKey',    appKey.value.trim()));
    appSecret.addEventListener('change', () => localStorage.setItem('dbx_appSecret', appSecret.value.trim()));

    authBtn.addEventListener('click', () => {
        const key = appKey.value.trim();
        if (!key) { alert('Enter App Key first'); return; }
        localStorage.setItem('dbx_appKey', key);
        localStorage.setItem('dbx_appSecret', appSecret.value.trim());
        const url = `https://www.dropbox.com/oauth2/authorize?client_id=${key}&response_type=code&token_access_type=offline`;
        window.open(url, '_blank');
        codeRow.style.display = 'block';
    });

    codeSubmit.addEventListener('click', async () => {
        const code   = codeInput.value.trim();
        const key    = localStorage.getItem('dbx_appKey');
        const secret = localStorage.getItem('dbx_appSecret');
        if (!code || !key || !secret) { alert('Missing code or credentials'); return; }
        try {
            const res = await fetch('https://api.dropbox.com/oauth2/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ code, grant_type: 'authorization_code',
                    client_id: key, client_secret: secret })
            });
            const data = await res.json();
            if (data.access_token) {
                localStorage.setItem('dbx_accessToken',  data.access_token);
                localStorage.setItem('dbx_refreshToken', data.refresh_token || '');
                localStorage.setItem('dbx_tokenExpiry',  Date.now() + (data.expires_in || 14400) * 1000);
                codeRow.style.display = 'none';
                codeInput.value = '';
                updateCloudStatus();
                showToast('Dropbox connected ✓');
            } else {
                alert('Auth failed: ' + (data.error_description || JSON.stringify(data)));
            }
        } catch (e) { alert('Error: ' + e.message); }
    });
}

async function dbxGetAccessToken() {
    const expiry = parseInt(localStorage.getItem('dbx_tokenExpiry') || '0');
    if (Date.now() < expiry - 60000) return localStorage.getItem('dbx_accessToken');
    // Refresh
    const key    = localStorage.getItem('dbx_appKey');
    const secret = localStorage.getItem('dbx_appSecret');
    const refresh= localStorage.getItem('dbx_refreshToken');
    if (!key || !secret || !refresh) throw new Error('Dropbox not connected. Open Settings to authorize.');
    const res = await fetch('https://api.dropbox.com/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ refresh_token: refresh, grant_type: 'refresh_token',
            client_id: key, client_secret: secret })
    });
    const data = await res.json();
    if (!data.access_token) throw new Error('Dropbox token refresh failed');
    localStorage.setItem('dbx_accessToken', data.access_token);
    localStorage.setItem('dbx_tokenExpiry', Date.now() + (data.expires_in || 14400) * 1000);
    return data.access_token;
}

async function shareViaDropbox(content, statusEl) {
    const token = await dbxGetAccessToken();
    const path  = '/playlist.m3u';

    statusEl.textContent = 'Uploading to Dropbox…';
    const uploadRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/octet-stream',
            'Dropbox-API-Arg': JSON.stringify({ path, mode: 'overwrite', autorename: false, mute: true })
        },
        body: content
    });
    if (!uploadRes.ok) throw new Error(`Dropbox upload failed (${uploadRes.status})`);

    // Get or create shared link
    statusEl.textContent = 'Getting share link…';
    let linkRes = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, settings: { requested_visibility: 'public' } })
    });
    if (linkRes.status === 409) {
        // Link already exists — fetch existing
        const listRes = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, direct_only: true })
        });
        const listData = await listRes.json();
        linkRes = { ok: true, _data: listData.links?.[0] };
    }
    const linkData = linkRes._data || await linkRes.json();
    if (!linkData?.url) throw new Error('Could not get Dropbox share link');
    // Convert to direct download URL
    return linkData.url.replace('www.dropbox.com', 'dl.dropboxusercontent.com').replace('?dl=0', '');
}

// ── Google Drive OAuth2 ───────────────────────────────────────────────────────
function initGdriveSettings() {
    const clientId     = document.getElementById('gdriveClientId');
    const clientSecret = document.getElementById('gdriveClientSecret');
    const authBtn      = document.getElementById('gdriveAuthorizeBtn');
    const codeRow      = document.getElementById('gdriveCodeRow');
    const codeInput    = document.getElementById('gdriveCodeInput');
    const codeSubmit   = document.getElementById('gdriveCodeSubmit');

    clientId.value     = localStorage.getItem('gdrive_clientId')     || '';
    clientSecret.value = localStorage.getItem('gdrive_clientSecret') || '';

    clientId.addEventListener('change',     () => localStorage.setItem('gdrive_clientId',     clientId.value.trim()));
    clientSecret.addEventListener('change', () => localStorage.setItem('gdrive_clientSecret', clientSecret.value.trim()));

    authBtn.addEventListener('click', () => {
        const id = clientId.value.trim();
        if (!id) { alert('Enter Client ID first'); return; }
        localStorage.setItem('gdrive_clientId',     id);
        localStorage.setItem('gdrive_clientSecret', clientSecret.value.trim());
        const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${id}` +
            `&redirect_uri=urn:ietf:wg:oauth:2.0:oob&response_type=code` +
            `&scope=https://www.googleapis.com/auth/drive.file&access_type=offline&prompt=consent`;
        window.open(url, '_blank');
        codeRow.style.display = 'block';
    });

    codeSubmit.addEventListener('click', async () => {
        const code   = codeInput.value.trim();
        const id     = localStorage.getItem('gdrive_clientId');
        const secret = localStorage.getItem('gdrive_clientSecret');
        if (!code || !id || !secret) { alert('Missing code or credentials'); return; }
        try {
            const res = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ code, grant_type: 'authorization_code',
                    client_id: id, client_secret: secret,
                    redirect_uri: 'urn:ietf:wg:oauth:2.0:oob' })
            });
            const data = await res.json();
            if (data.access_token) {
                localStorage.setItem('gdrive_accessToken',  data.access_token);
                localStorage.setItem('gdrive_refreshToken', data.refresh_token || '');
                localStorage.setItem('gdrive_tokenExpiry',  Date.now() + (data.expires_in || 3600) * 1000);
                codeRow.style.display = 'none';
                codeInput.value = '';
                updateCloudStatus();
                showToast('Google Drive connected ✓');
            } else {
                alert('Auth failed: ' + (data.error_description || JSON.stringify(data)));
            }
        } catch (e) { alert('Error: ' + e.message); }
    });
}

async function gdriveGetAccessToken() {
    const expiry = parseInt(localStorage.getItem('gdrive_tokenExpiry') || '0');
    if (Date.now() < expiry - 60000) return localStorage.getItem('gdrive_accessToken');
    const id      = localStorage.getItem('gdrive_clientId');
    const secret  = localStorage.getItem('gdrive_clientSecret');
    const refresh = localStorage.getItem('gdrive_refreshToken');
    if (!id || !secret || !refresh) throw new Error('Google Drive not connected. Open Settings to authorize.');
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ refresh_token: refresh, grant_type: 'refresh_token',
            client_id: id, client_secret: secret })
    });
    const data = await res.json();
    if (!data.access_token) throw new Error('Google Drive token refresh failed');
    localStorage.setItem('gdrive_accessToken', data.access_token);
    localStorage.setItem('gdrive_tokenExpiry', Date.now() + (data.expires_in || 3600) * 1000);
    return data.access_token;
}

async function shareViaGdrive(content, statusEl) {
    const token   = await gdriveGetAccessToken();
    const fileId  = localStorage.getItem('gdrive_fileId');

    if (fileId) {
        // Update existing file
        statusEl.textContent = 'Updating Google Drive file…';
        const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
            body: content
        });
        if (!res.ok) {
            localStorage.removeItem('gdrive_fileId');
            return shareViaGdrive(content, statusEl);
        }
    } else {
        // Create new file
        statusEl.textContent = 'Uploading to Google Drive…';
        const meta = JSON.stringify({ name: 'playlist.m3u', mimeType: 'text/plain' });
        const boundary = '-------m3ueditor';
        const body = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--`;
        const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
            body
        });
        if (!uploadRes.ok) throw new Error(`Drive upload failed (${uploadRes.status})`);
        const fileData = await uploadRes.json();
        localStorage.setItem('gdrive_fileId', fileData.id);

        // Make publicly readable
        statusEl.textContent = 'Setting permissions…';
        await fetch(`https://www.googleapis.com/drive/v3/files/${fileData.id}/permissions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'reader', type: 'anyone' })
        });
    }

    const id = localStorage.getItem('gdrive_fileId');
    return `https://drive.google.com/uc?export=download&id=${id}`;
}

function updateCloudStatus() {
    const dbxStatus    = document.getElementById('dbxStatus');
    const gdriveStatus = document.getElementById('gdriveStatus');
    if (dbxStatus) {
        const connected = !!localStorage.getItem('dbx_refreshToken');
        dbxStatus.textContent   = connected ? '✓ Connected' : '';
        dbxStatus.style.color   = connected ? 'green' : '';
    }
    if (gdriveStatus) {
        const connected = !!localStorage.getItem('gdrive_refreshToken');
        gdriveStatus.textContent = connected ? '✓ Connected' : '';
        gdriveStatus.style.color = connected ? 'green' : '';
    }
}

function settingShowIcons() {
    return localStorage.getItem('setting_showIcons') === 'true';
}

// ── Group sort & move ──────────────────────────────────────────────────────────

let groupSortAscending = true; // toggles each click

function sortGroupsAlphabetically() {
    getGroupCounts();
    const allGroups = [...getGroupCounts().keys()];

    // Sort only within the active tab — sorting across all types would intermix
    // Live/Movie/Series groups and break positional type classification.
    const tabGroups = allGroups.filter(g => getGroupContentType(g) === activeContentType);
    if (groupSortAscending) {
        tabGroups.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    } else {
        tabGroups.sort((a, b) => b.localeCompare(a, undefined, { sensitivity: 'base' }));
    }

    const btn = document.getElementById('sortGroupsBtn');
    const icon = btn.querySelector('i');
    if (groupSortAscending) {
        if (icon) icon.className = 'bi bi-sort-alpha-down-alt';
        btn.title = 'Groups sorted A→Z. Click to sort Z→A.';
    } else {
        if (icon) icon.className = 'bi bi-sort-alpha-down';
        btn.title = 'Groups sorted Z→A. Click to sort A→Z.';
    }
    groupSortAscending = !groupSortAscending;

    // Rebuild full order with only this tab's groups reordered
    const tabSet = new Set(tabGroups);
    let ti = 0;
    const newOrder = allGroups.map(g => tabSet.has(g) ? tabGroups[ti++] : g);

    _reorderGroupsTo(newOrder, groupSortAscending ? 'Sort groups Z→A' : 'Sort groups A→Z');
}

function moveSelectedGroups(direction) {
    // Use the highlighted range; fall back to the active group if no range is set
    const moveSet = _rangeGroups.size > 0 ? _rangeGroups
                  : selectedGroup            ? new Set([selectedGroup])
                  : new Set();
    if (moveSet.size === 0) return;

    getGroupCounts(); // ensure indexes are ready
    const allGroups = [...getGroupCounts().keys()];

    // Operate only within the current tab — moving across content-type boundaries
    // would place e.g. a Movie group into the Live section, which makes no sense.
    const tabGroups = allGroups.filter(g => getGroupContentType(g) === activeContentType);
    const selected  = Array.from(moveSet);

    if (direction === 'up') {
        const firstIdx = tabGroups.findIndex(g => selected.includes(g));
        if (firstIdx === 0) return; // already at top of this tab
        for (let i = 1; i < tabGroups.length; i++) {
            if (selected.includes(tabGroups[i]))
                [tabGroups[i - 1], tabGroups[i]] = [tabGroups[i], tabGroups[i - 1]];
        }
    } else {
        const lastIdx = tabGroups.reduce((acc, g, i) => selected.includes(g) ? i : acc, -1);
        if (lastIdx === tabGroups.length - 1) return; // already at bottom of this tab
        for (let i = tabGroups.length - 2; i >= 0; i--) {
            if (selected.includes(tabGroups[i]))
                [tabGroups[i + 1], tabGroups[i]] = [tabGroups[i], tabGroups[i + 1]];
        }
    }

    // Rebuild allGroups: replace tab's groups with the newly ordered slice
    const tabSet = new Set(tabGroups);
    let ti = 0;
    const newOrder = allGroups.map(g => tabSet.has(g) ? tabGroups[ti++] : g);

    const label = selected.join(', ');
    _reorderGroupsTo(newOrder, `Move ${direction} · ${label}`);
}

// Rebuild m3uData in the given group order and re-render
function _reorderGroupsTo(orderedGroups, description = 'Reorder groups') {
    pushUndo(m3uData.slice(), selectedGroup, description);
    updateUndoButton();
    const newData = [];
    orderedGroups.forEach(groupName => {
        const items = groupItemsIndex.get(groupName) || [];
        // avoid spread (...items) — it passes items as function args and overflows
        // the call stack on large groups (1M+ channels)
        for (let i = 0; i < items.length; i++) newData.push(items[i]);
    });
    m3uData = newData;

    invalidateGroupCache();
    renderGroups();
    saveToLocalStorage();
}

function updateGroupsOrder(evt) {
    if (!evt) return;

    // Use the DOM order as the source of truth — it already reflects content-type
    // tab + search filter, so evt.oldIndex / evt.newIndex map correctly.
    const visibleGroups = Array.from(groupsList.children)
        .map(el => el.dataset.groupName)
        .filter(Boolean);

    // All groups in their current order (from indexes, not DOM)
    getGroupCounts();
    let allGroups = [...getGroupCounts().keys()];

    // Find where the visible range STARTS in allGroups.
    // We must search by set-membership, NOT by visibleGroups[0], because after a drag
    // visibleGroups[0] is whatever ended up first in the DOM — not the original first
    // group. indexOf(visibleGroups[0]) would return its old position and the splice
    // would start one slot too late, making position 0 unreachable.
    const visibleSet = new Set(visibleGroups);
    const firstVisibleIdx = allGroups.findIndex(g => visibleSet.has(g));
    if (firstVisibleIdx < 0 || visibleGroups.length === 0) return;

    if (_rangeGroups.size <= 1) {
        // Single drag: SortableJS already committed the correct DOM order — apply it.
        allGroups.splice(firstVisibleIdx, visibleGroups.length, ...visibleGroups);
    } else {
        const dragSet = new Set(_rangeGroups);

        // Count how many NON-dragged groups appear before the drop point in the DOM.
        let remainingBefore = 0;
        for (let i = 0; i < evt.newIndex; i++) {
            if (!dragSet.has(visibleGroups[i])) remainingBefore++;
        }

        const remainingVisible = visibleGroups.filter(g => !dragSet.has(g));
        const orderedSelected  = visibleGroups.filter(g =>  dragSet.has(g));

        const newVisible = [
            ...remainingVisible.slice(0, remainingBefore),
            ...orderedSelected,
            ...remainingVisible.slice(remainingBefore),
        ];

        allGroups.splice(firstVisibleIdx, visibleGroups.length, ...newVisible);
    }

    const dragLabel = Array.from(_rangeGroups).join(', ') || 'group';
    pushUndo(m3uData.slice(), selectedGroup, `Drag move · ${dragLabel}`);
    updateUndoButton();

    const newData = [];
    allGroups.forEach(groupName => {
        const items = groupItemsIndex.get(groupName) || [];
        for (let i = 0; i < items.length; i++) newData.push(items[i]); // no spread — avoids stack overflow on large groups
    });
    m3uData = newData;

    // After drag, keep the dragged group active.
    // _rangeGroups holds exactly the dragged groups (single or multi).
    const firstDragged = Array.from(_rangeGroups)[0];
    if (firstDragged) selectedGroup = firstDragged;

    invalidateGroupCache();
    saveToLocalStorage();
    renderGroups();
}



function generateM3U() {
    let result = '#EXTM3U\n';
    
    m3uData.forEach(item => {
        let extinf = '#EXTINF:-1';
        if (item.tvgId) extinf += ` tvg-id="${item.tvgId}"`;
        if (item.tvgName) extinf += ` tvg-name="${item.tvgName}"`;
        if (item.tvgLogo) extinf += ` tvg-logo="${item.tvgLogo}"`;
        if (item.groupTitle) extinf += ` group-title="${item.groupTitle}"`;
        extinf += `,${item.name}`;
        
        result += extinf + '\n' + item.url + '\n';
    });
    
    return result;
}

function downloadM3U() {
    const content = generateM3U();
    const blob = new Blob([content], { type: 'application/x-mpegurl' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'playlist.m3u';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ── Share (upload + shorten) ──────────────────────────────────────────────────
document.getElementById('shareBtn').addEventListener('click', shareM3U);
document.getElementById('shareModalClose').addEventListener('click', () => {
    document.getElementById('shareModal').style.display = 'none';
});
document.getElementById('shareUrlCopy').addEventListener('click', () => {
    const input = document.getElementById('shareUrlInput');
    input.select();
    navigator.clipboard.writeText(input.value).then(() => {
        const notice = document.getElementById('shareUrlCopied');
        notice.style.display = 'block';
        setTimeout(() => { notice.style.display = 'none'; }, 2000);
    });
});

async function shareM3U() {
    const modal    = document.getElementById('shareModal');
    const spinner  = document.getElementById('shareSpinner');
    const result   = document.getElementById('shareResult');
    const errorEl  = document.getElementById('shareError');
    const statusEl = document.getElementById('shareStatus');

    modal.style.display   = 'flex';
    spinner.style.display = 'flex';
    result.style.display  = 'none';
    errorEl.style.display = 'none';
    document.getElementById('shareUrlCopied').style.display = 'none';

    const provider = localStorage.getItem('setting_cloudProvider');
    if (!provider) {
        spinner.style.display = 'none';
        errorEl.style.display = 'block';
        errorEl.innerHTML = 'No cloud provider selected.<br>Open <strong>Settings</strong>, choose Dropbox or Google Drive, and authorize.';
        return;
    }

    try {
        const content = generateM3U();
        let rawUrl;

        if (provider === 'dropbox') {
            rawUrl = await shareViaDropbox(content, statusEl);
        } else if (provider === 'gdrive') {
            rawUrl = await shareViaGdrive(content, statusEl);
        } else {
            throw new Error('Unknown provider: ' + provider);
        }

        // ── Shorten with is.gd ───────────────────────────────────────────────
        statusEl.textContent = 'Generating short URL…';
        let finalUrl = rawUrl;
        try {
            const shortRes = await fetch(
                `https://is.gd/create.php?format=simple&url=${encodeURIComponent(rawUrl)}`
            );
            if (shortRes.ok) finalUrl = (await shortRes.text()).trim();
        } catch (_) { /* silently fall back to raw URL */ }

        // ── Show result + QR code ────────────────────────────────────────────
        document.getElementById('shareUrlInput').value = finalUrl;
        spinner.style.display = 'none';
        result.style.display  = 'block';

        const qrContainer = document.getElementById('shareQR');
        qrContainer.innerHTML = '';
        const qrImg = document.createElement('img');
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(finalUrl)}`;
        qrImg.alt = 'QR code';
        qrImg.style.cssText = 'width:160px;height:160px;border-radius:8px;';
        qrContainer.appendChild(qrImg);

    } catch (err) {
        spinner.style.display = 'none';
        errorEl.style.display = 'block';
        errorEl.textContent   = `Error: ${err.message}`;
    }
}

function saveToLocalStorage() {
    // Skip serialisation for large playlists — JSON.stringify alone is very slow at this scale
    if (m3uData.length > 10000) {
        console.warn('Playlist too large for localStorage, skipping save.');
        return;
    }
    try {
        localStorage.setItem('m3uData', JSON.stringify(m3uData));
    } catch (e) {
        console.warn('localStorage save skipped (quota exceeded):', e.message);
    }
}

function loadFromLocalStorage() {
    try {
        const savedData = localStorage.getItem('m3uData');
        if (savedData) {
            m3uData = JSON.parse(savedData);
            if (m3uData.length > 0) {
                invalidateGroupCache();
                getGroupCounts();              // triggers buildAllIndexes() with empty persist map
                reclassifySeriesGroups();      // positional sweep on fresh data
                _persistentGroupTypes = new Map(groupTypeCache); // lock in the types
                renderContentTypeTabs();
                renderGroups();
                downloadBtn.disabled = false;
            }
        }
    } catch (e) {
        console.warn('Could not load from localStorage:', e.message);
    }
}

loadFromLocalStorage();

function updateItemGroupTitleDropdown(selectedValue) {
    // Use cached group list — no m3uData scan
    const groups = [...getGroupCounts().keys()];
    const fragment = document.createDocumentFragment();
    groups.forEach(group => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.className = 'dropdown-item';
        a.href = '#';
        a.textContent = group;
        a.addEventListener('click', (e) => {
            e.preventDefault();
            itemGroupTitleSelected.textContent = group;
            itemGroupTitleInput.value = group;
        });
        li.appendChild(a);
        fragment.appendChild(li);
    });
    itemGroupTitleDropdownMenu.innerHTML = '';
    itemGroupTitleDropdownMenu.appendChild(fragment);

    if (selectedValue) {
        itemGroupTitleSelected.textContent = selectedValue;
        itemGroupTitleInput.value = selectedValue;
    } else if (groups.length > 0) {
        itemGroupTitleSelected.textContent = groups[0];
        itemGroupTitleInput.value = groups[0];
    } else {
        itemGroupTitleSelected.textContent = 'No Group';
        itemGroupTitleInput.value = 'No Group';
    }
}

function saveGroupRename(oldName, newName) {
    if (!newName.trim() || oldName === newName) {
        renamingGroup = null;
        renderGroups();
        return;
    }
    // Shallow-copy each item so in-place groupTitle mutations don't corrupt the snapshot
    pushUndo(m3uData.map(item => ({ ...item })), selectedGroup, `Rename "${oldName}" → "${newName}"`);
    updateUndoButton();
    m3uData.forEach(item => {
        if (item.groupTitle === oldName) item.groupTitle = newName;
    });
    // Keep the content-type assignment under the new name
    const _renamedType = _persistentGroupTypes.get(oldName);
    if (_renamedType !== undefined) {
        _persistentGroupTypes.delete(oldName);
        _persistentGroupTypes.set(newName, _renamedType);
    }
    renamingGroup = null;
    if (selectedGroup === oldName) selectedGroup = newName;
    invalidateGroupCache();
    saveToLocalStorage();
    renderGroups();
}

function saveItemRename(index, newName) {
    if (!newName.trim()) {
        renamingItemIndex = null;
        renderItems();
        return;
    }
    const oldName = selectedGroupItems[index]?.name || '';
    // Shallow-copy each item so in-place name mutations don't corrupt the snapshot
    pushUndo(m3uData.map(item => ({ ...item })), selectedGroup, `Rename channel "${oldName}" → "${newName}"`);
    updateUndoButton();
    selectedGroupItems[index].name = newName;
    const globalIndex = m3uData.findIndex(i => i === selectedGroupItems[index]);
    if (globalIndex !== -1) {
        m3uData[globalIndex].name = newName;
    }
    renamingItemIndex = null;
    saveToLocalStorage();
    renderItems();
}

const itemUrlPreview = document.getElementById('itemUrlPreview');

function updateItemUrlPreview(url) {
    if (!url) {
        itemUrlPreview.href = '#';
        itemUrlPreview.classList.add('disabled');
        itemUrlPreview.setAttribute('tabindex', '-1');
    } else {
        itemUrlPreview.href = url;
        itemUrlPreview.classList.remove('disabled');
        itemUrlPreview.removeAttribute('tabindex');
    }
}
itemUrlInput.addEventListener('input', (e) => {
    updateItemUrlPreview(e.target.value);
});
itemUrlPreview.addEventListener('click', (e) => {
    if (!itemUrlInput.value) e.preventDefault();
});
