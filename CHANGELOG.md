# Changelog

All notable changes to M3U Editor Pro are documented here.

---

## [0.3.0] - 2026-04-05

### Selection Model Overhaul
- **Separated selection from checking**: click navigates only, Space checks/unchecks, Shift+Arrow builds a visual range — three distinct actions, no accidental side effects
- Renamed internal `selectedItems` → `checkedItems` for clarity
- Added `_rangeGroups` set to track highlighted (selected) groups independently of checked state
- Ctrl+click toggles a group in/out of the highlighted range
- Shift+click selects a contiguous range without checking any boxes
- Checked groups show only the checkbox tick — no row background highlight
- Single click on the already-active group toggles its checkbox
- `checkbox.blur()` after click so arrow keys continue to work immediately

### Delete Behaviour
- **Keyboard Delete** acts on the highlighted range or active group only — completely ignores `checkedItems`
- **Trash button** acts on `checkedItems` only; tooltip reads "Delete Checked Items" to make the distinction clear
- After deletion, cursor lands on the first surviving group at the same list position (no jump to top)
- Checked items are preserved when deleting an unchecked selected group via keyboard
- Deleting a group works with just a selection — no checkbox required

### Rename
- **Enter** starts rename on the active group; **Enter** saves; **Esc** cancels without saving
- Double-click on group row removed as rename trigger
- Fixed bug where pressing Enter to save immediately re-opened rename (missing `stopPropagation`)

### Drag & Sort
- **Auto-scroll during drag** — manual `requestAnimationFrame` loop tracks cursor position and scrolls the group list in both directions; replaces unreliable SortableJS built-in scroll
- Fixed drag-to-first-position bug (`indexOf` replaced with `findIndex` on visible set)
- Sort (A→Z / Z→A) and Move Up/Down are now scoped to the active content-type tab only — no cross-tab reordering

### Content-Type Detection
- `_persistentGroupTypes` map is set once on file load and survives all mutations (sort, delete, rename) — fixes Movies tab disappearing after operations
- `reclassifySeriesGroups()` replaced fragile positional sweep with **group-level URL and channel-name sampling**: samples up to 5 channels per group, checks URLs for VOD paths and channel names for `S01E01` / `Season X` patterns
- Removed `.mkv` / `.mp4` extension from movie URL detection — series use these formats too
- Live groups with movie-sounding names (e.g. "Film 4", "BFI Films") are corrected back to Live when their channel URLs are live-stream format (`.ts`, `.m3u8`)

### Channel Icons
- New opt-in setting: **Show channel icons** (off by default)
- Icons displayed at 32×32 px with 16 px gap; channel name left-aligned via `flex: 1`
- Broken icons hidden automatically via `onerror`
- `ITEM_HEIGHT` updated to 46 px to accommodate icons

### Undo
- Undo support added for: group renames, channel renames, group moves (Up/Down buttons), channel drag reorder
- Fixed undo for renames: snapshot used `m3uData.slice()` (shallow copy) which allowed in-place mutation to corrupt the snapshot — replaced with `m3uData.map(item => ({...item}))` (deep copy per item)

### Share Feature *(work in progress — hidden)*
- Upload playlist to **Dropbox** or **Google Drive** via full OAuth2 with refresh token (auto-refreshes, no repeated logins)
- URL shortened via **is.gd**; **QR code** displayed for easy TV entry
- Provider selector in Settings panel (Dropbox / Google Drive)
- Hidden until a reliable direct-URL hosting solution is confirmed

### Bug Fixes
- Sort button icon destroyed when updating label text — fixed by updating `icon.className` instead of `btn.textContent`
- Select All / deselect all not syncing checkbox state — fixed by routing through `syncGroupCheckboxes()`
- Arrow-key navigation broken after checkbox click — fixed with `checkbox.blur()`
- Enter saving rename then immediately re-entering edit mode — fixed with `e.stopPropagation()` in rename input
- Channel name incorrectly centred between icon and URL badge — fixed with `flex: 1` on name span
- `draggedGroup` undefined reference in `updateGroupsOrder` — replaced with `Array.from(_rangeGroups)[0]`

---

## [0.2.1] - 2025
- Updated branding, README, and project links

## [0.2.0] - 2025
- Initial release as M3U Editor Pro

## [0.1.0] - 2025
- Original release
