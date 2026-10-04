# Publishing and updates

**Status:** this project lives at https://github.com/phsrp/Vibe-video-editor and version **1.0.0** is
published under [Releases](https://github.com/phsrp/Vibe-video-editor/releases/latest).

How it works: each time a version tag (like `v1.0.1`) is pushed, GitHub builds the Windows installer by itself
(about 3 minutes) and publishes it as a **Release**. Copies of the editor that people have installed look at the
latest release, and offer to download it (see **Updates** in the README).

---

## Sending an update

**The easy way:** tell Claude what you want changed and then say "push an update". Claude bumps the version number,
commits, pushes, tags it, and checks that GitHub's build finishes and the installer appears.

**By hand with GitHub Desktop** (a free app, https://desktop.github.com):
1. Make the change. In `package.json` raise `"version"`, for example from `1.0.0` to `1.0.1`.
2. In GitHub Desktop: write a short description, **Commit to main**, then **Push origin**.
3. **History** tab, right-click that commit, **Create Tag…**, type `v1.0.1` (the letter `v` plus the exact version
   number from `package.json`), **Create Tag**, then **Push origin**.
4. On github.com open the **Actions** tab and wait for the green tick, then check **Releases**.

Installed copies find out about it shortly after they start (or when someone clicks **Settings → Check now**) and
show the **Download / Remind me later** window. Nothing is downloaded without clicking Download.

Projects, settings and your own transitions are kept when updating (they live in your user profile, not in the
program folder).

---

## Good to know

- **Version numbers must go up**, and the tag must match `package.json` (tag `v1.0.1` means version `1.0.1`).
- **The repository must stay public.** Installed copies read the releases without any password.
- **Windows "protected your PC" warning:** the installer is not signed with a paid certificate, so Windows shows this
  on first run. Click **More info → Run anyway**. It is normal for unsigned apps.
- **Old versions stay** on the Releases page, so you can always download an earlier one.
- **Where things are stored:** `%APPDATA%\vibe-video-editor` holds settings, recent projects, caches and your transitions folder.
- **Build on your own PC instead** (no GitHub): run `npm run dist`. The installer appears in the `release` folder.
- **Pictures in the README** can be recreated with `scripts/make-banner.js` (the banner). The screenshots were
  taken from the running app.
