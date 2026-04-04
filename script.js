let m3uData = [];
let selectedGroup = null;
let selectedItems = new Set();
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
let activeContentType = 'all'; // 'all' | 'live' | 'movie' | 'series'

// Single-pass indexes — rebuilt once after load/mutation, used everywhere
let groupTypeCache = new Map();   // groupName → 'live'|'movie'|'series'
let groupItemsIndex = new Map();  // groupName → item[]  (replaces O(n) filter in renderItems)

function detectContentType(url, groupTitle) {
    const u = (url || '').toLowerCase();
    const g = (groupTitle || '').toLowerCase();
    if (u.includes('/movie/') || /\.(mkv|mp4|avi|mov)(\?|$)/.test(u)) return 'movie';
    if (u.includes('/series/')) return 'series';
    if (u.includes('/live/') || /\.(ts|m3u8)(\?|$)/.test(u)) return 'live';
    if (g.includes('movie') || g.includes('vod') || g.includes('film')) return 'movie';
    if (g.includes('series') || g.includes('show') || g.includes('season') || g.includes('episode')) return 'series';
    return 'live';
}

// One pass over m3uData builds groupTypeCache, groupItemsIndex, and _groupCountsCache
function buildAllIndexes() {
    groupTypeCache.clear();
    groupItemsIndex.clear();
    _groupCountsCache = new Map();

    for (const item of m3uData) {
        const g = item.groupTitle || 'No Group';

        // items index
        if (!groupItemsIndex.has(g)) {
            groupItemsIndex.set(g, []);
            // content type: use first item in each group
            groupTypeCache.set(g, detectContentType(item.url, g));
        }
        groupItemsIndex.get(g).push(item);

        // count cache
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
    // Hide tabs if only one type is present
    const typesUsed = ['live', 'movie', 'series'].filter(t => counts[t] > 0);
    if (typesUsed.length <= 1) {
        if (tabBar) tabBar.remove();
        return;
    }

    if (!tabBar) {
        tabBar = document.createElement('div');
        tabBar.id = 'contentTypeTabs';
        tabBar.style.cssText = 'display:flex;gap:4px;padding:6px 0 4px 0;flex-wrap:wrap;';
        // Insert before the filter input's wrapper div, which IS a direct child of container
        const filterWrapper = document.getElementById('groupsFilterInput').parentElement;
        container.insertBefore(tabBar, filterWrapper);
    }

    const tabs = [
        { id: 'all', label: '📋 All' },
        { id: 'live', label: '📡 Live' },
        { id: 'movie', label: '🎬 Movies' },
        { id: 'series', label: '📺 Series' },
    ];

    tabBar.innerHTML = '';
    tabs.forEach(({ id, label }) => {
        if (id !== 'all' && counts[id] === 0) return;
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm ' + (activeContentType === id ? 'btn-primary' : 'btn-outline-secondary');
        btn.textContent = label + (id === 'all' ? '' : ` (${counts[id]})`);
        btn.onclick = () => {
            activeContentType = id;
            selectedGroup = null;
            selectedItems.clear();
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

const groupsSortable = new Sortable(groupsList, {
    animation: 150,
    onStart: function(evt) {
        const groupName = evt.item.textContent.split(' (')[0];
        if (selectedItems.size > 1 && selectedItems.has(groupName)) {
            evt.item.classList.add('dragging-selected');
        } else {
            selectedItems.clear();
            selectedItems.add(groupName);
        }
    },
    onEnd: function(evt) {
        evt.item.classList.remove('dragging-selected');
        updateGroupsOrder(evt);
        renderGroups();
    },
    onChoose: function(evt) {
        if (window.getSelection) {
            window.getSelection().removeAllRanges();
        } else if (document.selection) {
            document.selection.empty();
        }
    }
});

function getGroupIndex(groupName) {
    const groups = [...new Set(m3uData.map(item => item.groupTitle || 'No Group'))];
    return groups.indexOf(groupName);
}

const itemsSortable = new Sortable(itemsList, {
    animation: 150,
    onStart: function(evt) {
        
        if (selectedItems.size > 1 && selectedItems.has(evt.oldIndex)) {
            
            evt.item.classList.add('dragging-selected');
        } else {
            
            selectedItems.clear();
            selectedItems.add(evt.oldIndex);
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
    invalidateGroupCache();
    saveToLocalStorage();
    renderGroups();
});

document.getElementById('deleteGroupsBtn').addEventListener('click', deleteSelectedGroups);
document.getElementById('deleteItemsBtn').addEventListener('click', deleteSelectedItems);
document.getElementById('sortGroupsBtn').addEventListener('click', sortGroupsAlphabetically);
document.getElementById('moveGroupUpBtn').addEventListener('click', () => moveSelectedGroups('up'));
document.getElementById('moveGroupDownBtn').addEventListener('click', () => moveSelectedGroups('down'));
document.getElementById('selectAllGroupsBtn').addEventListener('click', selectAllGroups);
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

    let selectedIndices = Array.from(selectedItems);
    let selectedItemsData = selectedIndices.map(i => selectedGroupItems[i]);

    if (selectedItems.size <= 1) {
        selectedIndices = [evt.oldIndex];
        selectedItemsData = [selectedGroupItems[evt.oldIndex]];
    }

    const remainingItems = selectedGroupItems.filter((_, i) => !selectedIndices.includes(i));

    let insertAt = evt.newIndex;
    if (evt.oldIndex < evt.newIndex) {
        insertAt = evt.newIndex - selectedIndices.filter(i => i < evt.newIndex).length + 1;
    }

    const newOrder = [
        ...remainingItems.slice(0, insertAt),
        ...selectedItemsData,
        ...remainingItems.slice(insertAt)
    ];

    m3uData = m3uData.filter(item => item.groupTitle !== selectedGroup);
    m3uData = [...m3uData, ...newOrder];

    selectedItems.clear();
    for (let i = 0; i < selectedItemsData.length; i++) {
        selectedItems.add(insertAt + i);
    }

    invalidateGroupCache();
    renderItems();
    saveToLocalStorage();
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
    moveItemsBtn.disabled = selectedItems.size === 0 || groups.length === 0;
}


function moveSelectedItemsToGroup(targetGroup) {
    if (selectedItems.size === 0 || !selectedGroup) return;

    
    
    const selectedItemIndices = Array.from(selectedItems);
    const itemsToMove = selectedItemIndices.map(index => selectedGroupItems[index]).filter(Boolean);

    
    itemsToMove.forEach(item => {
        item.groupTitle = targetGroup;
    });

    
    selectedItems.clear();

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
    const hasSelection = selectedItems.size > 0;
    document.getElementById('deleteGroupsBtn').disabled = !hasSelection;
    document.getElementById('deleteItemsBtn').disabled = !hasSelection || !selectedGroup;
    moveItemsBtn.disabled = !hasSelection || !selectedGroup || groupDropdown.children.length === 0;
    document.getElementById('moveGroupUpBtn').disabled = !hasSelection;
    document.getElementById('moveGroupDownBtn').disabled = !hasSelection;
}

// ── Toast notifications ────────────────────────────────────────────────────────

function showToast(message, undoFn, duration = 5000) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'alert alert-dark d-flex align-items-center gap-2 mb-0 shadow py-2 px-3';
    toast.style.cssText = 'min-width:280px;max-width:500px;pointer-events:all;';

    const msg = document.createElement('span');
    msg.textContent = message;
    msg.style.flex = '1';
    toast.appendChild(msg);

    let timer;

    if (undoFn) {
        const undoBtn = document.createElement('button');
        undoBtn.className = 'btn btn-sm btn-warning';
        undoBtn.textContent = 'Undo';
        undoBtn.onclick = () => {
            clearTimeout(timer);
            if (toast.parentNode) container.removeChild(toast);
            undoFn();
        };
        toast.appendChild(undoBtn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-close btn-sm';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.onclick = () => {
        clearTimeout(timer);
        if (toast.parentNode) container.removeChild(toast);
    };
    toast.appendChild(closeBtn);

    container.appendChild(toast);

    timer = setTimeout(() => {
        if (toast.parentNode) {
            toast.style.transition = 'opacity .4s';
            toast.style.opacity = '0';
            setTimeout(() => { if (toast.parentNode) container.removeChild(toast); }, 400);
        }
    }, duration);
}

function deleteSelectedGroups() {
    if (selectedItems.size === 0) return;

    const groupsToDelete = new Set(selectedItems);
    const groupCount = groupsToDelete.size;

    // Count channels in the groups being deleted (indexes must be ready)
    getGroupCounts();
    const channelCount = [...groupsToDelete].reduce((sum, g) => sum + (groupItemsIndex.get(g) || []).length, 0);

    if (localStorage.getItem('setting_confirmDelete') === 'true') {
        if (!confirm(`Delete ${groupCount} group(s) and ${channelCount} channel(s)?`)) return;
    }

    // Shallow snapshot for undo — copies references, not deep clones
    const snapshot = m3uData.slice();
    const prevSelectedGroup = selectedGroup;

    m3uData = m3uData.filter(item => !groupsToDelete.has(item.groupTitle || 'No Group'));
    selectedItems.clear();
    selectedGroup = null;

    invalidateGroupCache();
    renderGroups();
    itemsList.innerHTML = '';
    itemDetailsForm.reset();
    saveToLocalStorage();
    updateDeleteButtonsState();

    showToast(
        `Deleted ${groupCount} group${groupCount !== 1 ? 's' : ''} · ${channelCount} channel${channelCount !== 1 ? 's' : ''}`,
        () => {
            m3uData = snapshot;
            selectedGroup = prevSelectedGroup;
            invalidateGroupCache();
            renderGroups();
            saveToLocalStorage();
        }
    );
}

function deleteSelectedItems() {
    if (selectedItems.size === 0 || !selectedGroup) return;

    const indicesToDelete = Array.from(selectedItems).sort((a, b) => b - a);
    const groupItems = groupItemsIndex.get(selectedGroup) || [];
    const deleteCount = indicesToDelete.filter(i => groupItems[i]).length;

    if (localStorage.getItem('setting_confirmDelete') === 'true') {
        if (!confirm(`Delete ${deleteCount} channel(s) from "${selectedGroup}"?`)) return;
    }

    // Shallow snapshot for undo
    const snapshot = m3uData.slice();
    const prevSelectedGroup = selectedGroup;

    indicesToDelete.forEach(index => {
        const itemToDelete = groupItems[index];
        if (itemToDelete) {
            const itemIndex = m3uData.findIndex(item => item === itemToDelete);
            if (itemIndex !== -1) m3uData.splice(itemIndex, 1);
        }
    });

    selectedItems.clear();
    invalidateGroupCache();
    renderItems();
    itemDetailsForm.reset();
    saveToLocalStorage();
    updateDeleteButtonsState();

    showToast(
        `Deleted ${deleteCount} channel${deleteCount !== 1 ? 's' : ''} from "${prevSelectedGroup}"`,
        () => {
            m3uData = snapshot;
            selectedGroup = prevSelectedGroup;
            invalidateGroupCache();
            renderGroups();
            saveToLocalStorage();
        }
    );
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
                const nameMatch = line.match(/,(.*)$/);
                currentItem.name = nameMatch ? nameMatch[1].trim() : 'Unnamed';
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
            // Indexes already built — go straight to render
            showLoading('Rendering…', 97);
            setTimeout(() => {
                try {
                    saveToLocalStorage();
                    renderContentTypeTabs();
                    renderGroups();
                    downloadBtn.disabled = false;
                } catch (err) {
                    console.error('Render error:', err);
                } finally {
                    hideLoading();
                }
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

    // Filter by content type tab
    if (activeContentType !== 'all') {
        groups = groups.filter(g => getGroupContentType(g) === activeContentType);
    }
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
                if (e.key === 'Enter') saveGroupRename(group, input.value);
            });
            const saveBtn = document.createElement('button');
            saveBtn.className = 'btn btn-sm btn-success ms-1';
            saveBtn.textContent = 'Save';
            saveBtn.onclick = () => saveGroupRename(group, input.value);
            groupItem.appendChild(input);
            groupItem.appendChild(saveBtn);
            setTimeout(() => { input.focus(); input.select(); }, 50);
        } else {
            const nameSpan = document.createElement('span');
            nameSpan.textContent = group;
            const countSpan = document.createElement('span');
            countSpan.className = 'badge bg-secondary ms-2';
            countSpan.textContent = groupCounts.get(group) || 0;
            groupItem.appendChild(nameSpan);
            groupItem.appendChild(countSpan);
            groupItem.addEventListener('click', (e) => selectGroup(e, group, idx));
            groupItem.addEventListener('dblclick', () => {
                renamingGroup = group;
                renderGroups();
            });
            if (selectedItems.has(group)) groupItem.classList.add('selected');
            if (selectedGroup === group) groupItem.classList.add('active');
        }
        fragment.appendChild(groupItem);
    });
    groupsList.appendChild(fragment);

    // Dropdowns are built lazily on demand — no need to build them on every render
    if (groups.length > 0 && !selectedGroup) {
        selectGroup(null, groups[0], 0);
    }
}

function selectGroup(event, groupName, groupIdx) {
    const groupDisplayName = groupName.split(' (')[0];
    const items = Array.from(groupsList.children);
    let idx = groupIdx;
    if (typeof idx !== 'number') {
        // use data attribute — textContent also contains the badge count number
        idx = items.findIndex(item => item.dataset.groupName === groupDisplayName);
    }

    if (event && (event.ctrlKey || event.metaKey)) {
        // Ctrl+click (Windows/Linux) or Cmd+click (Mac) — toggle this group in the selection
        if (selectedItems.has(groupDisplayName)) {
            selectedItems.delete(groupDisplayName);
        } else {
            selectedItems.add(groupDisplayName);
        }
        items.forEach((item, i) => {
            const itemGroupName = item.dataset.groupName;
            item.classList.toggle('selected', selectedItems.has(itemGroupName));
            item.classList.toggle('active', i === idx && selectedItems.has(groupDisplayName));
        });
        updateDeleteButtonsState();
        return;
    } else if (event && event.shiftKey) {
        // Shift+click — select a contiguous range
        const activeIdx = items.findIndex(item => item.classList.contains('active'));
        const endIdx = idx;
        const [start, end] = [Math.min(activeIdx, endIdx), Math.max(activeIdx, endIdx)];
        selectedItems.clear();
        for (let i = start; i <= end; i++) {
            const itemGroupName = items[i].dataset.groupName;
            if (itemGroupName) selectedItems.add(itemGroupName);
        }
        items.forEach((item, i) => {
            const itemGroupName = item.dataset.groupName;
            item.classList.toggle('selected', selectedItems.has(itemGroupName));
            item.classList.toggle('active', i === activeIdx);
        });
        updateDeleteButtonsState();
        return;
    }

    // Normal single click
    selectedItems.clear();
    selectedItems.add(groupDisplayName);
    selectedGroup = groupDisplayName;
    items.forEach((item, i) => {
        const itemGroupName = item.dataset.groupName;
        item.classList.toggle('selected', selectedItems.has(itemGroupName));
        item.classList.toggle('active', i === idx);
    });
    renderItems();
    updateDeleteButtonsState();
}

const ITEM_HEIGHT = 42; // px per row
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
        const nameSpan = document.createElement('span');
        nameSpan.textContent = item.name || 'Unnamed';
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
        if (selectedItems.has(index)) itemElement.classList.add('selected');
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
            selectedItems.add(index);
        } else {
            selectedItems.delete(index);
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
            selectedItems.add(i);
        }
        updateDeleteButtonsState();
        return;
    }
    
    
    selectedItems.clear();
    selectedItems.add(index);
    
    
    Array.from(itemsList.children).forEach((el, i) => {
        el.classList.toggle('active', i === index);
        el.classList.toggle('selected', selectedItems.has(i));
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
    if (activeContentType !== 'all') {
        groups = groups.filter(g => getGroupContentType(g) === activeContentType);
    }
    if (groupsFilterValue) {
        groups = groups.filter(g => g.toLowerCase().includes(groupsFilterValue));
    }

    const allAlreadySelected = groups.length > 0 && groups.every(g => selectedItems.has(g));

    if (allAlreadySelected) {
        // Deselect all
        selectedItems.clear();
        selectedGroup = null;
        itemsList.innerHTML = '';
        itemDetailsForm.reset();
    } else {
        // Select all visible groups
        selectedItems.clear();
        groups.forEach(g => selectedItems.add(g));
        // keep selectedGroup so the channel panel stays visible
    }

    // Update visual state in the list
    Array.from(groupsList.children).forEach(item => {
        const name = item.dataset.groupName;
        item.classList.toggle('selected', selectedItems.has(name));
    });

    updateDeleteButtonsState();
}

// ── Settings ──────────────────────────────────────────────────────────────────

function initSettings() {
    const checkbox = document.getElementById('settingConfirmDelete');
    checkbox.checked = localStorage.getItem('setting_confirmDelete') === 'true';
    checkbox.addEventListener('change', () => {
        localStorage.setItem('setting_confirmDelete', checkbox.checked ? 'true' : 'false');
    });
}

// ── Group sort & move ──────────────────────────────────────────────────────────

let groupSortAscending = true; // toggles each click

function sortGroupsAlphabetically() {
    // Ensure indexes are ready (in case user hasn't interacted yet)
    getGroupCounts();

    let groups = [...getGroupCounts().keys()];
    if (groupSortAscending) {
        groups.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    } else {
        groups.sort((a, b) => b.localeCompare(a, undefined, { sensitivity: 'base' }));
    }

    const btn = document.getElementById('sortGroupsBtn');
    if (groupSortAscending) {
        btn.textContent = 'Sort Z-A';
        btn.title = 'Groups sorted A→Z. Click to sort Z→A.';
    } else {
        btn.textContent = 'Sort A-Z';
        btn.title = 'Groups sorted Z→A. Click to sort A→Z.';
    }
    groupSortAscending = !groupSortAscending;

    _reorderGroupsTo(groups);
}

function moveSelectedGroups(direction) {
    if (selectedItems.size === 0) return;

    getGroupCounts(); // ensure indexes are ready
    let groups = [...getGroupCounts().keys()];
    const selected = Array.from(selectedItems);

    if (direction === 'up') {
        // Don't move if the topmost selected group is already at position 0
        const firstIdx = groups.findIndex(g => selected.includes(g));
        if (firstIdx === 0) return;

        // Iterate top-to-bottom: swap each selected group with the one above it
        for (let i = 1; i < groups.length; i++) {
            if (selected.includes(groups[i])) {
                [groups[i - 1], groups[i]] = [groups[i], groups[i - 1]];
            }
        }
    } else {
        // Don't move if the bottommost selected group is already at the last position
        const lastIdx = groups.reduce((acc, g, i) => selected.includes(g) ? i : acc, -1);
        if (lastIdx === groups.length - 1) return;

        // Iterate bottom-to-top: swap each selected group with the one below it
        for (let i = groups.length - 2; i >= 0; i--) {
            if (selected.includes(groups[i])) {
                [groups[i + 1], groups[i]] = [groups[i], groups[i + 1]];
            }
        }
    }

    _reorderGroupsTo(groups);
}

// Rebuild m3uData in the given group order and re-render
function _reorderGroupsTo(orderedGroups) {
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
    
    let allGroups = [...new Set(m3uData.map(item => item.groupTitle || 'No Group'))];
    let filteredGroups = allGroups;
    if (groupsFilterValue) {
        filteredGroups = allGroups.filter(g => g.toLowerCase().includes(groupsFilterValue));
    }
    
    
    const draggedGroup = filteredGroups[evt.oldIndex];
    
    if (selectedItems.size <= 1) {
        
        const dropGroup = filteredGroups[evt.newIndex];
        const from = allGroups.indexOf(draggedGroup);
        let to = allGroups.indexOf(dropGroup);
        if (to === -1) to = allGroups.length - 1;
        
        allGroups.splice(from, 1);
        allGroups.splice(to, 0, draggedGroup);
    } else {
        
        const selectedGroupNames = Array.from(selectedItems);
        const selectedIndices = filteredGroups.map((g, i) => selectedGroupNames.includes(g) ? i : -1).filter(i => i !== -1);
        
        
        let remainingGroups = filteredGroups.filter(g => !selectedGroupNames.includes(g));
        
        
        let insertAt = evt.newIndex;
        if (insertAt > Math.min(...selectedIndices)) {
            
            insertAt = insertAt - selectedIndices.filter(i => i < insertAt).length + 1;
        }
        
        
        filteredGroups = [
            ...remainingGroups.slice(0, insertAt),
            ...selectedGroupNames,
            ...remainingGroups.slice(insertAt)
        ];
        
        
        allGroups = filteredGroups;
    }
    
    
    const newData = [];
    allGroups.forEach(groupName => {
        const groupItems = groupItemsIndex.get(groupName) || [];
        newData.push(...groupItems);
    });
    
    m3uData = newData;

    if (selectedItems.size > 1) {
        selectedGroup = Array.from(selectedItems)[0];
    } else {
        selectedGroup = draggedGroup;
    }

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
    m3uData.forEach(item => {
        if (item.groupTitle === oldName) item.groupTitle = newName;
    });
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
