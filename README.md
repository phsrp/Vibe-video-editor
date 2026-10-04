<p align="center">
  <img src="docs/banner.png" alt="Completely made with AI: Vibe Video Editor was designed, written, tested and packaged by Claude (Anthropic) from plain-English instructions." width="100%">
</p>

<h1 align="center">Vibe Video Editor</h1>

<p align="center">
  A Windows video editor with goofy PowerPoint-style transitions, keyframes, multi-track audio and 4K export.<br>
  <b>Every line of it was written by AI.</b>
</p>

<p align="center">
  <a href="https://github.com/phsrp/Vibe-video-editor/releases/latest"><img alt="Download" src="https://img.shields.io/github/v/release/phsrp/Vibe-video-editor?label=download&color=c4a7e7&style=for-the-badge"></a>
  <img alt="Made with AI" src="https://img.shields.io/badge/made%20with-AI-ebbcba?style=for-the-badge">
  <img alt="Windows" src="https://img.shields.io/badge/platform-Windows-31748f?style=for-the-badge">
</p>

---

> ## 🤖 Made completely with AI
> This whole app (the editor, the transitions, the exporter, the installer, the updater and this page) was built by
> **Claude** (an AI made by Anthropic) through a conversation. The person who asked for it does not write code: they
> described what they wanted in plain English, and the AI wrote, ran, tested and fixed everything itself.
> Expect the occasional rough edge, and please report anything odd under **Issues**.

---

## Screenshots

**Home page.** Start a new project, open one, or jump back into a recent one. You can keep several projects open at once, each in its own tab.

![Home page](docs/screenshots/home.png)

**The editor.** Media bin, live preview, timeline with separate audio lanes, and an inspector for motion and transitions. Here the preview is partway through a cube transition.

![The editor](docs/screenshots/editor.png)

**Light theme.** Rosé Pine (dark) is the default; Rosé Pine Dawn is one click away in Settings.

![Light theme](docs/screenshots/editor-dawn.png)

**Export.** 1080p, 2K or 4K, 24/30/60 fps, H.264 or H.265, adjustable bitrate, with a progress bar and time estimate.

![Export dialog](docs/screenshots/export.png)

## Features

### Editing
- **Import** videos, images and audio files (button or drag-and-drop from Explorer).
- **Timeline:** drag clips to reorder, drag their edges to **trim**, **split** at the playhead, zoom in and out, undo and redo.
- **Select like in Explorer:** drag a box around clips and audio to select several, or hold Ctrl/Shift to add to the selection.
- **Groups:** group any mix of video and audio clips so they move together; ungroup when you are done.
- **Freeze frame:** save the exact frame under the playhead as an image and insert it. Drag its edge (or type seconds) to hold it as long as you like.
- **Motion keyframes:** animate **position, scale, rotation and opacity** with seven easing styles (linear, smooth, ease in, ease out, overshoot, bounce, hold). Keyframes show as diamonds on the timeline, and you can drag them to retime.
- **Warp:** select a clip, press **Warp on preview**, and drag its four corners to bend the picture. Add a keyframe, move the playhead, drag again and pick an easing to animate it.
- **Overlay video tracks:** **Add track → Video** makes a layer that sits on top of the video below it. Clips there can start at any time. Drag any track by its label to move it up or down, and double-click a track name to rename it.
- **Waveforms:** audio lanes show the loudness of each clip, so you can see where the sound starts and stops.

### Transitions
- **18 PowerPoint-style transitions**, where the whole frame does the effect: cube, doors, curtains, page curl, peel, fall over, fracture, shred, crush, wind, vortex, ripple, spin, rotate, push, wipe, zoom and fade.
- Pick one per cut and set its length (0.2 to 4 seconds). Preview it with one click.
- **Add your own:** transitions are plain `.glsl` files in the [gl-transitions](https://gl-transitions.com/) format. Drop a new file into the transitions folder, press **Reload**, and it appears. No rebuild needed.

![All 18 transitions](docs/screenshots/transitions.png)

### Audio
- A recording with several audio streams (for example game + microphone) shows each stream as **its own lane** with its own volume and mute.
- Add extra audio files (music, voice-over) on their own tracks.
- **Detach** one stream, or all of a clip's audio, to move, trim or delete it on its own, and **group** it back later.
- Audio crossfades automatically during transitions.

### Projects
- **Save and open** projects as `.json` files. Your videos are referenced, not copied.
- **Autosave** every 15 seconds. If the editor closes before you save, it offers to bring the work back.
- **Home page** with your recent projects, and **tabs** so you can work on several projects at once.

### Export
- **1080p, 2K or 4K**, **24, 30 or 60 fps**, **H.264 or H.265**, adjustable **bitrate**, and a speed/quality setting.
- Mix all audio into one track, or **keep every track separate** in the file.
- Progress bar with an estimated time left, and a Cancel button.
- Powered by a bundled copy of FFmpeg, so there is nothing else to install.

## Install

1. Open the [**Releases** page](https://github.com/phsrp/Vibe-video-editor/releases/latest).
2. Download **Vibe-Video-Editor-Setup-x.y.z.exe** and run it. It installs just for you (no administrator password) and adds a Desktop and Start menu shortcut.
3. Windows may say **"Windows protected your PC"** because the installer is not signed with a paid certificate. Click **More info**, then **Run anyway**.

## Updates

The editor can tell you when a new version is out, and it **never downloads anything without asking**.

**Checking for updates**
- Click **Settings** (top right), then **Check now**. The version number next to it also opens Settings.
- Or just wait: with automatic updates on, it checks a few seconds after the editor starts and every few hours.

**When there is an update** a window pops up with two choices:
- **Download** shows a progress bar, then **Restart now** or **Later** (if you pick Later, it installs the next time you close the editor).
- **Remind me later** closes the window and asks again in about 4 hours. A small **Update** button stays in the top bar.

**Turning automatic updates on or off**
- Open **Settings** (top right) and use the **Automatic updates** switch. It is **on by default**.
- When it is off, the editor never checks by itself. You can still use **Check now** whenever you like.

Your projects, settings and your own transitions are kept when you update.

## Keyboard shortcuts

Every shortcut can be changed under **⌨ Shortcuts** in the timeline toolbar.

| Action | Default |
|---|---|
| Split at the playhead | `S` |
| Freeze frame | `F` |
| Play / pause | `Space` |
| Step one frame back / forward | `←` / `→` |
| Go to the start | `Home` |
| Delete the selection | `Delete` |
| Group / Ungroup | `Ctrl+G` / `Ctrl+Shift+G` |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Y` |
| Save / Save as | `Ctrl+S` / `Ctrl+Shift+S` |
| Open a project | `Ctrl+O` |
| Export | `Ctrl+E` |

## Where things are stored

| What | Where |
|---|---|
| Your projects | wherever you saved the `.json` file |
| Settings, recent projects, caches | `%APPDATA%\vibe-video-editor` |
| Your transitions folder | `%APPDATA%\vibe-video-editor\transitions` (also the **Transitions folder** button in the editor) |

## Build it yourself

You need [Node.js](https://nodejs.org) (LTS).

```bash
npm install
npm start          # run the editor
npm run dist       # build the installer into the release folder
```

Releases are built automatically by GitHub when a version tag such as `v1.0.1` is pushed (see [PUBLISHING.md](PUBLISHING.md)).

## Built with

- [Electron](https://www.electronjs.org/) and [React](https://react.dev/), with WebGL for the preview and transitions
- [FFmpeg](https://ffmpeg.org/) through `ffmpeg-static` for import, audio and export. **Note:** that FFmpeg build includes GPL-licensed encoders (x264 and x265), which matters if you redistribute the installer.
- Transition format from [gl-transitions](https://gl-transitions.com/)
- [Montserrat](https://github.com/JulietaUla/Montserrat) font (SIL Open Font License)
- [Rosé Pine](https://rosepinetheme.com/) colours (MIT)
- Icons drawn in the style of [Lucide](https://lucide.dev/) (ISC)

## License

No license has been chosen yet, so all rights are reserved by default. If you want others to be able to use or change this code, add a license file.
