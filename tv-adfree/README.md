# AdFree Tube for Samsung TVs

A small Tizen app that opens YouTube's TV interface with ads removed. It strips ad data out of YouTube's responses before the player sees them. If an ad still gets through, it skips it automatically. It has no extra features, so there's less to break.

Built for the QN55S90DAFXZA (2024, Tizen 8). It should also work on other Samsung TVs from 2017 onward.

## How it works

1. You open **AdFree Tube**. It starts a small background service and closes.
2. The service relaunches the app in debug mode through the TV's own Developer Mode connection.
3. It registers the ad-block script (`service/src/adblock.js`) to run before YouTube's code on every page, then opens `youtube.com/tv`.
4. A small **"Ad blocking on"** badge appears in the top-right corner for a few seconds. If you don't see it, the blocker didn't load.

The script is built into the app rather than downloaded each time. YouTube changes can't silently swap in new code, and the app works even if a CDN is down.

## One-time setup

You need a computer (Windows, macOS, or Linux) on the same Wi-Fi network as the TV.

### 1. Install the tools on your computer

- [Node.js](https://nodejs.org) (LTS)
- [Tizen Studio](https://developer.tizen.org/development/tizen-studio/download) with the CLI
- In Tizen Studio's **Package Manager**, under **Extension SDK**, install **TV Extensions** and **Samsung Certificate Extension**

### 2. Put the TV in Developer Mode

1. Find your computer's IP address.
2. On the TV, open **Apps**, then press **1 2 3 4 5** on the remote. On a remote without number buttons, use the on-screen number pad.
3. Turn **Developer mode** on, enter your computer's IP address, and restart the TV. Hold the power button until the Samsung logo appears.
4. Find the TV's IP address under **Settings → General → Network → Network Status → IP Settings**.

### 3. Connect to the TV and create a certificate

```bash
sdb connect <TV_IP>
```

In Tizen Studio, open **Tools → Certificate Manager**. Create a **Samsung** certificate profile, choose **TV**, and sign in with a Samsung account. When it asks for device IDs, keep the connected TV's ID selected. Remember the profile name.

### 4. Build and install

```bash
cd tv-adfree
```

```bash
./package.sh <your-certificate-profile-name>
```

```bash
tizen install -n build/AdFree*.wgt -t $(sdb devices | awk 'NR==2{print $3}')
```

### 5. Point Developer Mode at the TV itself

This step is required. It lets the app attach to itself.

1. On the TV, open **Apps** and press **1 2 3 4 5** again.
2. Change the Host PC IP to **127.0.0.1**.
3. Restart the TV.

Open **AdFree Tube** from Apps. You can move it to your home row.

## Troubleshooting

| What you see | Fix |
|---|---|
| "Developer Mode is off" | Developer Mode turns off after some firmware updates. Turn it back on and set the IP to 127.0.0.1 (step 5). |
| "Host PC IP is …" | Set it to 127.0.0.1 and restart the TV. |
| Stuck on "Loading YouTube…" | Fully restart the TV by holding the power button, then open the app again. |
| YouTube opens without the "Ad blocking on" badge | The script didn't load. Restart the TV and try again. |
| Ads show up after a YouTube update | YouTube renamed something. Edit the field names in `service/src/adblock.js`, then rebuild and reinstall. |

**To reinstall or update:** change the Developer Mode IP back to your computer's IP, run steps 3–4, then set it back to 127.0.0.1.

**Firmware updates:** consider turning off **Settings → Support → Software Update → Auto Update**. Updates can turn off Developer Mode, and Tizen 9 has had reported YouTube problems on 2024 models.

## Files

| File | Purpose |
|---|---|
| `config.xml` | Tizen app manifest |
| `index.html` | Launcher screen, setup messages, and remote media keys |
| `service/src/index.js` | Background service that debug-launches the app and inserts the script |
| `service/src/adblock.js` | The ad blocker that runs inside YouTube |
| `package.sh` | Builds, stages, and signs the `.wgt` |
