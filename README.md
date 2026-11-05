# Glass Dock 1.0

A Mac-style dock for Windows, with a Dynamic Island, workspaces and auto-updates.

## Install it properly, with auto-updates

The code lives at **github.com/agnardadi1/glass-dock**. Each time a new version is tagged there, GitHub builds the Windows installer on its own machines and publishes it under **Releases**. No tokens or build commands are needed on your PC.

1. Go to **github.com/agnardadi1/glass-dock/releases**, download **Glass Dock Setup x.y.z.exe** and run it. If Windows says "Windows protected your PC", click **More info → Run anyway** (the app isn't signed).
2. In the dock settings, turn on **Behaviour → Start with Windows**.
3. From now on, quit any `npm start` copy and let the installed dock run.

When a new version is released, the installed dock downloads it by itself within a few hours. The island then shows **"Glass Dock 1.0.1 is ready → Restart"**, which is also in the tray menu and in **Settings → Behaviour → Updates**. If you don't click Restart, it installs the next time the dock closes.

### Releasing a new version yourself

1. Raise `"version"` in `package.json` (for example `1.0.0` → `1.0.1`) and commit.
2. Push a matching tag: `git tag v1.0.1` and then `git push --tags`.
3. Watch it build under the repository's **Actions** tab. It takes about 5 minutes, then the release appears.

You can also run the **Release** workflow by hand from the Actions tab.

## What's new in 1.0

**Workspaces.** Arrange your windows on both screens, then right-click the dock → **Workspaces → New workspace from open windows**. Each workspace gets a tile next to Start, and **Alt + Shift + 1…9** switches between them. Switching:
- opens the apps that aren't running yet
- moves every window back to its saved spot and screen
- minimises everything else
- closes the previous workspace's apps that the new one doesn't use

In **Settings → Workspaces** you can rename a workspace, pick its icon, snap each window to a zone (halves, thirds, two-thirds, quarters, full screen), move it to the other screen, give the workspace its own dock look, and add web pages to open. Right-click an open app → **Add to workspace** adds it to one. Right-click a workspace tile to update it with the windows that are open now.

**Badges.** Apps that put an unread number in their title ("(3) WhatsApp", Gmail's "Inbox (12)") get a red count on their icon. Apps that flash for attention, like Discord on a new message, glow orange and give a little nudge until you open them. Before, those flashes only showed on the Windows taskbar.

**Folder stacks.** Click **Downloads**, or any folder you pinned, to see its newest files above the dock. Click a file to open it, drag it straight into another app, or right-click it to show it in its folder.

**Game mode.** When a game is in front (anything full screen, or anything from Steam, Epic, Riot, GOG, Xbox, EA, Ubisoft or a "Games" folder), the dock gets out of the way and the island shrinks to a quiet pill with your GPU temperature, GPU load and the time. Volume changes still show. Hold the mouse at the bottom edge to bring the dock back. Change it in **Settings → Behaviour → Game mode**.

**Island hover options (0.6).** Hovering the quiet island shows your choice of clock, weather, PC stats, resume music, quick launch or clipboard history.

## Everyday use

| Do this | What happens |
| --- | --- |
| Click an app | Opens it, or switches to it. Click the app you're in to minimise it. |
| Right-click an app | Its windows, New window, Show in folder, Change icon, Add to workspace, Remove, Quit |
| Click Downloads or a pinned folder | Folder stack |
| Drag apps, shortcuts or folders onto the dock | Pins them |
| Drag a file onto an app / the Recycle Bin | Opens it with that app / deletes it |
| Alt + 1…9 | The app in that spot |
| Alt + Shift + 1…9 | Switch workspace |
| Right-click the empty part of the dock, or the tray icon | Settings, workspaces, auto-hide, updates, Quit |

Settings are saved in `%APPDATA%\glass-dock\dock.json`.

## If something goes wrong

- **The Windows taskbar stays hidden:** press **Ctrl + Shift + Esc**, find **Windows Explorer**, right-click it and choose **Restart**.
- **An empty strip at the top:** set **Windows Settings → Personalization → Taskbar → Taskbar behaviors → Taskbar position** to **Bottom**.
- **Anything else:** lines starting with `[…]` in the command window say which part failed.

## Known limits

- The glass doesn't blur the windows behind it (Windows can't blur behind a see-through shape like this).
- Badges only appear for apps that put a count in their window title, or that flash for attention.
- GPU stats need an NVIDIA card (they come from its driver). There's no FPS counter.
- A workspace can't restore browser tabs. List the pages you want under "Web pages to open".
- Store-style apps (Windows Settings, Calculator) and apps running as administrator can't be detected or moved.
