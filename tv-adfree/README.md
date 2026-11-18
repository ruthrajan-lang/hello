# AdFree Tube for Samsung TVs

A small Tizen app that opens YouTube's TV interface with ads removed and sponsor segments skipped (via SponsorBlock). It strips ad data out of YouTube's responses before the player sees them. If an ad still gets through, it skips it automatically. It has no extra features, so there's less to break.

Built for the QN55S90DAFXZA (2024, Tizen 8). It should also work on other Samsung TVs from 2017 onward.

## How it works

1. You open **AdFree Tube**. It starts a small background service and closes.
2. The service relaunches the app in debug mode through the TV's own Developer Mode connection.
3. It registers the ad-block script (`service/src/adblock.js`) to run before YouTube's code on every page, then opens `youtube.com/tv`.
4. A small **"Ad blocking on"** badge appears in the top-right corner for a few seconds. If you don't see it, the blocker didn't load.

The script is built into the app rather than downloaded each time. YouTube changes can't silently swap in new code, and the app works even if a CDN is down.

## AdFree Pluto

A second app, **AdFree Pluto**, plays Pluto TV's free on-demand movies and shows without the ad breaks. It doesn't cover live channels.

- Pluto splices its ads into the same video stream as the show. The app's background helper (`pluto/service/index.js`) downloads Pluto's playlist and keeps only the pieces that belong to the movie or episode itself, so the ad breaks are never played.
- It uses its own remote-friendly screens (`pluto/index.html`, `pluto/app.js`): rows of movies and series, a season and episode list, and a simple player.
- **Continue Watching** (top row) remembers what you watched on this TV and resumes where you stopped.
- Browse with the **All / Movies / TV Shows** tabs at the top, or search. Press **Up** from the first row to reach them.
- Player controls: **OK** pauses or plays, **◀ ▶** skip 10 seconds, **⏪ ⏩** skip 1 minute, and **Back** exits. The next episode plays automatically.
- It doesn't need the 127.0.0.1 Developer Mode setting, but leaving it set doesn't hurt.

## AdFree Updater (no more Host PC IP switching)

After one normal install, leave the TV's Host PC IP on **127.0.0.1** permanently. To update:

1. On the Mac, run `./install-mac.sh --serve`. It builds the apps and shares them on your Wi-Fi. If macOS asks whether Python may accept incoming connections, click **Allow**.
2. On the TV, open **AdFree Updater** and press **OK**. It finds the Mac, downloads the apps, and installs them through the TV's own developer connection.
3. When the TV says **All done**, press Ctrl+C on the Mac.

## Install (Mac)

You need your Mac and the TV on the same Wi-Fi network.

1. **Put the TV in Developer Mode.** On the TV, open **Apps**, press **1 2 3 4 5** on the remote, turn **Developer mode** on, and enter your Mac's IP address (**System Settings → Wi-Fi → Details**). Restart the TV by holding the power button until the Samsung logo appears.
2. **Find the TV's IP address** under **Settings → General → Network → Network Status → IP Settings**.
3. **Run the installer** in Terminal from this folder:

```bash
./install-mac.sh <TV_IP>
```

The script installs Samsung's command-line tools on the first run (about 5–10 minutes). It then connects to the TV and opens Samsung's Certificate Manager so you can sign in once and create the certificate. Finally, it builds, signs and installs the app. Follow its on-screen prompts.

### Last step: point Developer Mode at the TV itself

This step is required. It lets the app attach to itself.

1. On the TV, open **Apps** and press **1 2 3 4 5** again.
2. Change the Host PC IP to **127.0.0.1**.
3. Restart the TV.

Open **AdFree Tube** from Apps. You can move it to your home row.

## Troubleshooting

| What you see | Fix |
|---|---|
| "Developer Mode is off" | Developer Mode turns off after some firmware updates. Turn it back on and set the Host PC IP to 127.0.0.1. |
| "Host PC IP is …" | Set it to 127.0.0.1 and restart the TV. |
| Stuck on "Loading YouTube…" | Fully restart the TV by holding the power button, then open the app again. |
| YouTube opens without the "Ad blocking on" badge | The script didn't load. Restart the TV and try again. |
| Ads show up after a YouTube update | YouTube renamed something. Edit the field names in `service/src/adblock.js`, then rebuild and reinstall. |

**To reinstall or update:** change the Developer Mode IP back to your computer's IP, run `./install-mac.sh <TV_IP>` again, then set it back to 127.0.0.1.

**Firmware updates:** consider turning off **Settings → Support → Software Update → Auto Update**. Updates can turn off Developer Mode, and Tizen 9 has had reported YouTube problems on 2024 models.

## Files

| File | Purpose |
|---|---|
| `config.xml` | Tizen app manifest |
| `index.html` | Launcher screen, setup messages, and remote media keys |
| `service/src/index.js` | Background service that debug-launches the app and inserts the script |
| `service/src/adblock.js` | The ad blocker that runs inside YouTube |
| `package.sh` | Builds, stages, and signs the `.wgt` |
| `pluto/` | AdFree Pluto app and its playlist-cleaning service |
| `updater/` | AdFree Updater app: installs updates from the Mac over Wi-Fi |
| `install-mac.sh` | Mac installer: tools, certificate, build, and install |
