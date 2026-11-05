# Glass Dock – notes for Claude

- **Always ask Agnar before sending anything to GitHub.** That means pushing commits, and starting the Release workflow that publishes an update. Commit locally, tell him what's in the change, and wait for a clear yes.
- Releases: bump `version` in package.json, push to `main`, then start the **Release** workflow (`gh api -X POST repos/agnardadi1/glass-dock/actions/workflows/release.yml/dispatches -f ref=main`). Tag pushes are refused from Claude sessions.
- Before releasing, run `npm test`. It loads `src/win32.js` as if on Windows, so declaration-order mistakes can't crash the installed app. The workflow also loads it on real Windows before publishing.
- Agnar's setup: Windows 11, 5120×1440 ultrawide (main) and a portrait 2560×1440 screen, NVIDIA RTX 3080, Icelandic keyboard (so no Ctrl+Alt shortcuts, which are AltGr). He uses the Microsoft Store version of Spotify.
