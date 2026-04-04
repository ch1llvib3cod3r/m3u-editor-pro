# M3U Editor Pro

[![GitHub license](https://img.shields.io/github/license/ch1llvib3cod3r/m3u-editor-pro)](https://github.com/ch1llvib3cod3r/m3u-editor-pro/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/ch1llvib3cod3r/m3u-editor-pro)](https://github.com/ch1llvib3cod3r/m3u-editor-pro/stargazers)

A fast, privacy-first M3U playlist editor for managing large IPTV playlists entirely in your browser. No uploads, no server — your playlist never leaves your computer.

🔗 **Live Demo**: [https://ch1llvib3cod3r.github.io/m3u-editor-pro/](https://ch1llvib3cod3r.github.io/m3u-editor-pro/)

## ✨ Features

- **Privacy Focused** — Works completely client-side, your playlists never leave your computer
- **Handles large files** — Tested with 300MB+ M3U files (1M+ channels) without freezing
- **Bulk group management** — Select all, Ctrl+click or Shift+click to multi-select groups
- **Sort groups** — Sort A→Z or Z→A with a single click
- **Move groups** — Reorder groups with ↑/↓ buttons or drag and drop
- **Undo delete** — Delete groups or channels instantly with a toast notification and Undo button
- **Content type tabs** — Auto-detects and filters Live, Movies, and Series
- **Search & Filter** — Quickly find channels and groups
- **Drag & Drop** — Reorder channels and groups
- **Live Preview** — Test channel URLs directly from the editor
- **Settings** — Toggle confirmation dialogs on/off

## 🚀 Getting Started

### Using the Web Version
1. Visit [https://ch1llvib3cod3r.github.io/m3u-editor-pro/](https://ch1llvib3cod3r.github.io/m3u-editor-pro/)
2. Click "Choose File" to load your M3U file
3. Edit your playlist
4. Click "Download Modified M3U" when done

### Running Locally
1. Clone this repository:
   ```bash
   git clone https://github.com/ch1llvib3cod3r/m3u-editor-pro.git
   cd m3u-editor-pro
   ```
2. Open `index.html` in your browser

## 🛠️ How to Use

1. **Upload Your M3U File** — Click "Choose File" and select your M3U/M3U8 file

2. **Manage Groups**
   - Click **☑ All** to select all groups, then Ctrl+click to deselect the ones you want to keep
   - Use **Sort A-Z / Sort Z-A** to sort groups alphabetically
   - Use **↑ / ↓** buttons to move selected groups up or down
   - Drag and drop groups to reorder them
   - Double-click a group name to rename it

3. **Manage Channels**
   - Click a group to see its channels
   - Ctrl+click or Shift+click to multi-select channels
   - Drag and drop to reorder channels
   - Use the Move button to move channels to a different group

4. **Delete with Undo**
   - Delete groups or channels instantly — no confirmation dialog by default
   - A toast notification shows what was deleted with an **Undo** button (5 second window)
   - Enable confirmation dialogs via the ⚙ Settings button

5. **Save Your Changes** — Click "Download Modified M3U"

## 🌟 Tips

- Use the search box to quickly find specific channels or groups
- Hold **Ctrl** (or **Cmd** on Mac) while clicking to select multiple groups
- Hold **Shift** while clicking to select a range of groups
- Use content type tabs (Live / Movies / Series) to filter groups by type

## 🤝 Contributing

Contributions are welcome! Feel free to submit a Pull Request.

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- Based on [Awesome M3U Editor](https://github.com/arazgholami/awesome-m3u-editor) by [@arazgholami](https://github.com/arazgholami)
- Built with [Bootstrap 5](https://getbootstrap.com/)
- Icons by [Bootstrap Icons](https://icons.getbootstrap.com/)
- Drag and drop powered by [SortableJS](https://sortablejs.github.io/Sortable/)

---

Made with ❤️ by [@ch1llvib3cod3r](https://github.com/ch1llvib3cod3r) | [Star on GitHub](https://github.com/ch1llvib3cod3r/m3u-editor-pro)
