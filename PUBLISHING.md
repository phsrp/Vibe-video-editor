# Publishing the editor on GitHub (and sending updates)

You never need to type commands. Everything below uses **GitHub Desktop** (a free app with buttons).

How it works: you keep the project on GitHub. Each time you "tag" a new version, GitHub builds the
installer by itself and publishes it as a **Release**. Copies of the editor that people have installed
notice the new release, download it, and show **"Restart to update"** in the top bar.

---

## One-time setup

1. **Make a GitHub account** at https://github.com (free).
2. **Install GitHub Desktop** from https://desktop.github.com and sign in with your account.
3. **Put the project on GitHub**
   1. In GitHub Desktop: **File → Add local repository…** and choose this project folder.
   2. It says the folder is not a repository: click **create a repository**.
   3. Leave the name as it is (or use `vibe-video-editor`), click **Create repository**.
   4. Type `First version` in the box at the bottom left and click **Commit to main**.
   5. Click **Publish repository**. **Untick "Keep this code private"** (the editor can only check
      for updates on a public repository), then click **Publish repository**.
4. **Tell Claude your GitHub username and the repository name** so it can fill them into
   `package.json` (the `"owner"` and `"repo"` lines under `"publish"`). Or edit those two lines yourself.
   Then in GitHub Desktop: **Commit to main** and **Push origin**.
5. **Make the first release**
   1. In GitHub Desktop open the **History** tab, right-click the newest commit and choose **Create Tag…**
   2. Type `v1.0.0` and click **Create Tag**.
   3. Click **Push origin** (top bar).
   4. On github.com open your repository and click the **Actions** tab. A job called **Release** runs
      (about 5-10 minutes). Wait for the green tick.
   5. Back on the repository front page, on the right, click **Releases** and open **v1.0.0**.
      Download **Vibe-Video-Editor-Setup-1.0.0.exe** and run it. Install **this** one: it knows where to
      look for updates. (The installer in the project's `release` folder is only for testing.)

Windows may show **"Windows protected your PC"** because the installer is not signed with a paid
certificate. Click **More info → Run anyway**. It is normal for unsigned apps.

---

## Sending an update

1. Make the change (ask Claude, or edit yourself). Change `"version"` in `package.json` to a higher
   number, for example `1.0.1`. Claude will do this for you when you ask for an update.
2. In GitHub Desktop: type a short description, click **Commit to main**, then **Push origin**.
3. **History** tab → right-click that commit → **Create Tag…** → type `v1.0.1` (always the letter `v`
   plus the exact version number from `package.json`) → **Create Tag** → **Push origin**.
4. Wait for the green tick under **Actions** on github.com.
5. Anyone with the editor installed is told about it. A few seconds after the editor starts (and every
   4 hours after that) it checks GitHub. If there is a newer version, a window asks:
   - **Download**: downloads the update (with a progress bar), then offers **Restart now** or **Later**
     (if you pick Later it installs the next time you close the editor).
   - **Remind me later**: closes the window and asks again in about 4 hours. A small **Update x.y.z**
     button stays in the tab bar if you change your mind.

   Nothing is ever downloaded without clicking **Download**.
6. **Settings → Automatic updates** (on by default) turns the automatic checking on or off. You can
   always check by hand with **Settings → Check now**. The version number in the top right also opens Settings.
Projects, settings and your own transitions are kept when updating (they live in your user profile,
not in the program folder).

---

## Good to know

- **Private repository:** the update check needs the repository to be public. Your source code is then
  public too. (A way around it exists, but it needs an access token inside the app, so it is not recommended.)
- **Version numbers must go up.** If the tag and `package.json` disagree, the release gets the wrong name.
- **Old versions stay** on the Releases page, so you can always download an earlier one.
- **Where things are stored:** `%APPDATA%\vibe-video-editor` holds your transitions folder, caches and settings.
- **Build it on your own PC instead** (no GitHub): run `npm run dist`. The installer appears in the
  `release` folder. It will not auto-update unless it was built from a repository that is set up as above.
