# iPad2Spotify

A Spotify currently-playing dashboard designed for an iPad 2 running Safari/iOS 9.3.6. It shows album artwork, track information, playback state, and playback controls while Spotify plays on another device.

The frontend uses old-browser-compatible ES5 JavaScript and `XMLHttpRequest`. Spotify credentials and tokens are handled by Vercel Functions, not by the iPad browser.

Since we need to use Vercel anyways, the webapp creates a shortcode for a "badge" you can add to your github profile or anywhere displaying the song played last:

[![Last played on Spotify](https://ipad2spotify.vercel.app/api/badge/1170009226.svg)](https://ipad2spotify.vercel.app/)

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/cb0c0bec-ef17-40f6-b6ff-782786272c0a" />


## Winamp Mode

**Winamp Mode** is a Winamp 2.x-style remote control and display for Spotify: main window, equalizer, playlist and a Milkdrop window, drawn with the original Winamp 2.91 base-skin bitmaps. See [Features](#features) for how it behaves and what it deliberately does not do.

<img width="420" height="420" alt="4499" src="https://github.com/user-attachments/assets/9d934f26-f5d6-4f58-95dc-df640e9c3e9a" />

Credits and notices:
- Skin bitmaps: the Winamp 2.91 base skin (`vendor/winamp-skin/base-2.91`), as distributed with [Webamp](https://github.com/captbaritone/webamp) (MIT) by Jordan Eldredge and [winamp2-js](https://github.com/rvpanoz/winamp2-js). Sprite coordinates follow Webamp's skin sprite map. `scripts/build-winamp-skin.py` converts the BMPs into the PNG sheets the page uses.
- Milkdrop window: [OldMilk](https://www.npmjs.com/package/@turbolego/oldmilk), vendored in `vendor/oldmilk` with small local changes.
- Winamp is a trademark of Winamp SA / Nullsoft. This project is not affiliated with Winamp.

## What this project solves

An iPad 2 Home Screen web app runs in fullscreen mode, but interactive Spotify OAuth may open normal Safari. This project uses a two-step flow:

1. Open the deployed app in normal Safari on any device and select **Login to Spotify and get pairing code**.
2. Complete Spotify authorization. The callback displays a short-lived pairing code.
3. Open the deployed app from the iPad Home Screen.
4. Select **Enter pairing code** and enter the code.
5. The fullscreen app receives its own secure session and displays playback.

The pairing code expires after ten minutes and is deleted after it is claimed. The Home Screen app does not need to open Spotify login again unless its session expires.

## Adaptive playback updates

The iPad starts the currently-playing request; Vercel does not independently poll Spotify on a timer. Vercel is needed because it holds the Spotify Client Secret, refreshes access tokens, and performs the authorized Spotify request on behalf of the browser.

Playback polling does not use Redis at all. The paired session (the Spotify refresh token) is stored in an encrypted, `HttpOnly` cookie that only the Vercel Functions can decrypt, so each check is simply iPad → Vercel → Spotify. Redis is only used for the short-lived pairing code, badge records, and rate limits on the login/pairing endpoints (see [Redis usage](#redis-usage)).

To reduce Vercel Function invocations, the Home Screen app uses adaptive polling. When nothing is playing or playback is paused, it checks approximately every 60 seconds. During playback it checks approximately every 30 seconds, with a shorter check near the end of a track so the next song can be detected. When the Home Screen app is hidden or backgrounded, polling stops completely and resumes immediately when the page becomes visible again.

The player includes a refresh icon for an immediate check. When the player says **Nothing playing**, this may mean that Spotify has no active controllable playback, or simply that the first optimized background check has not occurred yet. Automatic checks can take up to 60 seconds; select the refresh icon after starting Spotify on another device rather than waiting.

During a request, the button changes to **Checking…** and displays a small loading animation. The animation uses ordinary CSS and remains compatible with Safari on iOS 9.3.6.

## Fork and deploy your own copy

Alternative 1: Use this button:

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fturbolego%2FiPad2Spotify&project-name=ipad2spotify&repository-name=ipad2spotify&integration-ids=oac_V3R1GIpkoJorr6fqyiwdhl17&env=SPOTIFY_CLIENT_ID&envDescription=Spotify%20app%20Client%20ID%20from%20the%20Spotify%20Developer%20Dashboard&envLink=https%3A%2F%2Fdeveloper.spotify.com%2Fdashboard&env=SPOTIFY_CLIENT_SECRET&envDescription=Spotify%20app%20Client%20Secret%20from%20the%20Spotify%20Developer%20Dashboard%20%28server-only%2C%20mark%20sensitive%29&envLink=https%3A%2F%2Fdeveloper.spotify.com%2Fdashboard&env=APP_ORIGIN&envDescription=Optional.%20Production%20origin%2C%20e.g.%20https%3A%2F%2Fyour-project.vercel.app.%20Used%20for%20the%20Spotify%20redirect%20URI.%20No%20trailing%20slash.&envLink=https%3A%2F%2Fvercel.com%2Fdocs%2Fenvironment-variables)

### 1. Fork this repository

Open [github.com/turbolego/iPad2Spotify](https://github.com/turbolego/iPad2Spotify) and select **Fork**. Choose your own GitHub account or organization and create the fork.

You can also clone the fork locally if you want to make changes:

```bash
git clone https://github.com/YOUR-GITHUB-USERNAME/iPad2Spotify.git
```

No build step or package installation is required.

### 2. Create a Spotify Developer app

Sign in to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) with the Spotify account whose playback should be displayed.

Select **Create app** and enter an app name and description. After creation:

1. Copy the **Client ID**.
2. Reveal and copy the **Client Secret**.
3. Keep the Client Secret private.

Do not commit the Client Secret to GitHub or place it in `index.html`, `app.js`, a URL, or any browser-visible file.

Spotify documentation: [Apps](https://developer.spotify.com/documentation/web-api/concepts/apps)

### 3. Import the fork into Vercel

Open the [Vercel Dashboard](https://vercel.com/dashboard):

1. Select **Add New → Project**.
2. Find your fork of `iPad2Spotify`.
3. Select **Import**.
4. Use the repository root as the Root Directory.
5. Choose **Other** as the Framework Preset, or leave automatic detection enabled.
6. Leave Build Command and Install Command empty. The `vercel.json` setting keeps the repository root as the Output Directory.
7. Select **Deploy**.

Vercel automatically exposes files under `api/` as serverless functions. The project is a plain static frontend plus Vercel Functions and needs no build command.

Copy the production URL, for example:

```text
https://your-project.vercel.app
```

### 4. Create the Redis/KV storage

The pairing flow needs a small shared database because Spotify login happens in normal Safari while the pairing code is entered in the separate fullscreen Home Screen app. Redis usage is small; see [Redis usage](#redis-usage).

In the Vercel project:

1. Open the **Storage** tab.
2. Select **Create Database** or **Connect Store**.
3. Choose the available **Upstash Redis** integration.
4. Create a database and connect it to this Vercel project.
5. Select the **Production** environment.

The integration should add these variables to the project:

```text
KV_REST_API_URL
KV_REST_API_TOKEN
```

The current implementation uses the normal read/write token. Do not use `KV_REST_API_READ_ONLY_TOKEN` for `KV_REST_API_TOKEN`, because the application must create, read, and delete pairing and badge records.

If the integration provides equivalent variables with different names, add aliases in Vercel:

```text
KV_REST_API_URL   = your Redis REST URL
KV_REST_API_TOKEN = your Redis REST read/write token
```

Upstash’s Vercel integration is documented at [Upstash for Vercel](https://vercel.com/marketplace/upstash).

### 5. Add Vercel environment variables

Open:

```text
Vercel project → Settings → Environment Variables
```

Add these variables for **Production**:

```text
SPOTIFY_CLIENT_ID       = Client ID copied from Spotify
SPOTIFY_CLIENT_SECRET   = Client Secret copied from Spotify
KV_REST_API_URL         = supplied by Upstash Redis
KV_REST_API_TOKEN       = supplied by Upstash Redis
```

Optionally add:

```text
APP_ORIGIN     = https://your-project.vercel.app
SESSION_SECRET = a long random string, e.g. output of `openssl rand -base64 32`
```

`SESSION_SECRET` is the key used to encrypt the session cookie. If it is omitted, a key is derived from `SPOTIFY_CLIENT_SECRET`. Changing either value logs out every paired device, which must then pair again.

`APP_ORIGIN` is useful when using a custom domain. Do not include a trailing slash. If it is omitted, the application derives the origin from the incoming request host.

`SPOTIFY_CLIENT_SECRET`, `SESSION_SECRET`, and the Redis token are server-only variables. Do not prefix them with `NEXT_PUBLIC_`.

Vercel documentation: [Environment Variables](https://vercel.com/docs/environment-variables)

### 6. Add the Spotify Redirect URI

Using the production URL from Vercel, construct:

```text
https://your-project.vercel.app/api/auth/callback
```

In the Spotify Developer Dashboard:

1. Open your Spotify app.
2. Select **Edit Settings**.
3. Find **Redirect URIs**.
4. Add the exact callback URL.
5. Select **Add** if required.
6. Select **Save**.

The redirect URI must match exactly, including `https`, the Vercel hostname, `/api/auth/callback`, capitalization, and trailing slash behavior.

Spotify documentation: [Redirect URIs](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri)

### 7. Redeploy after configuring variables

Environment-variable changes apply only to new deployments. In Vercel, open **Deployments**, select the latest deployment’s menu, and choose **Redeploy**.

Alternatively, push a new commit to the production branch of your fork.

### 8. Test login and pairing

Open the Vercel production URL in normal Safari or another browser and select **Login to Spotify and get pairing code**. Authorize the requested scopes:

- `user-read-currently-playing`
- `user-read-playback-state`
- `user-modify-playback-state`
- `user-read-recently-played` (used by the badge when nothing is currently playing)

After authorization, the callback page displays a pairing code. Open the same Vercel URL in Safari on the iPad, select **Add to Home Screen**, and open the new icon. In the fullscreen app select **Enter pairing code**, enter the code, and confirm.

You can complete the login on a phone or computer, then enter the resulting code on the iPad.

## GitHub README last-played badge

The player badge-creation button is currently hidden. Existing badge URLs continue to work. A badge URL is based on your Spotify account ID, so it is the same every time. The API displays Markdown similar to:

```markdown
[![Last played on Spotify](https://your-project.vercel.app/api/badge/<your-spotify-user-id>.svg)](https://your-project.vercel.app/)
```

You only need to add this to your GitHub profile once. When you log in to Spotify and pair again later, an existing badge is automatically updated with the new authorization, so the URL keeps working. A badge only exists for accounts that have created one; any other account ID returns 404. The Spotify account ID (shown in your Spotify profile link, `open.spotify.com/user/<id>`) is used rather than your email address, which is never requested or exposed.

Copy that Markdown into a GitHub profile `README.md`. The SVG displays the track currently playing on the account, or the most recently played track when nothing is playing, including album artwork, song title, and artist. For each badge request, the server asks Spotify directly (`GET /v1/me/player/currently-playing`, falling back to `GET /v1/me/player/recently-played?limit=1`) and selects `album.images[0].url`, the highest-resolution artwork returned by Spotify. It then downloads and embeds the artwork inside the SVG so GitHub does not need to load a remote image nested inside the badge. The badge is a public image URL: anyone who can see the README source can request it.

The badge lifecycle is: the badge creation endpoint stores a `badge:<spotify-user-id>` record in Redis together with the Spotify refresh token from the paired session (pairing again updates that record); GitHub requests `/api/badge/<key>.svg` when rendering the profile README; the badge endpoint reads that one Redis record, refreshes a Spotify access token, looks up the current or most recent track, embeds the album image, and returns an SVG. The response is cached by Vercel's CDN for five minutes, so each badge costs at most one Redis read per five minutes regardless of how often it is viewed.

The badge works independently of the iPad app: it reflects Spotify directly, even while the app is closed. GitHub and image proxies may cache the image, so changes can appear with a delay of several minutes. Badges created before the recently-played scope was added fall back to showing only the currently playing track until you log in to Spotify again and create a new badge.

The badge URL is a viewing URL, not a playback-control credential. Because it is based on your Spotify account ID, anyone who knows or guesses that ID can view your badge once it has been created. It does not expose Spotify access tokens, refresh tokens, Redis credentials, or the private session cookie. The badge record expires one year after the last login or badge creation. Badges created before account-based URLs were introduced (random keys) keep working until they expire. Disconnecting the iPad does not disable an existing badge; to stop a badge, revoke this app in your Spotify account settings (or delete the `badge:<key>` record in Redis).

## Redis usage

Redis (Upstash) is only used where state must be shared between separate browsers or requests:

| Key / use | When | Commands |
| --- | --- | --- |
| `pair:<code>` | Spotify login → pairing on the iPad | ~3 per login (SET, GET, DEL) plus 1–2 to refresh an existing badge, expires after 10 minutes |
| `rate:<bucket>:<ip>` | login, OAuth callback, pairing, badge creation | 1–2 per request on those rare endpoints |
| `badge:<spotify-user-id>` | creating and rendering a badge | 1 SET on creation, at most 1 GET per badge per 5 minutes |

Playback polling, playback commands, and searches use **zero** Redis commands. An always-on iPad therefore no longer consumes a meaningful share of the Upstash free tier (500,000 commands/month); a badge viewed constantly costs at most about 9,000 commands/month.

Sessions created by older versions (a random ID stored in Redis as `session:<id>`) are transparently converted to encrypted cookies on the next request, so existing paired iPads keep working. Existing badges are likewise upgraded on their first render; the old `session:` and `last:` keys expire on their own.

## Features

The dashboard provides:

- current album artwork,
- lyrics for the current track from lyrics.ovh (tap the album artwork to toggle),
- track title,
- artist and album,
- current playback state,
- play/pause,
- previous track,
- next track,
- a playback timeline slider for seeking to a position in the current track,
- adaptive currently-playing checks, normally every 15–30 seconds,
- Minimalist View with centered album artwork and track text,
- Search Artist to start artist radio playback for any artist,
- Search Playlist to find Spotify playlists and start a selected playlist.

The regular player has search and Minimalist View icon controls. Minimalist View centers the album cover on the screen and places the artist and song name directly below it, hiding the other controls and interface elements. A single tap toggles between artwork and lyrics; use the **X** in the top-right corner to return to the regular player.

In the regular player, tap the album artwork to switch to lyrics and use the **Album artwork** button to return. The lyrics panel expands alongside the player details, and its text can be scrolled when needed. If the track changes while lyrics are displayed, the lyrics remain open and update for the new track. Lyrics are looked up on demand from the lyrics.ovh API using the current artist and track title. Availability depends on the upstream catalog. The API returns plain lyrics, not timestamped lines, so lyrics do not scroll in sync with playback.

The Previous control follows Spotify's usual timing behavior: at 3 seconds or earlier it skips to the previous track; after 3 seconds it restarts the current track.

The **Search Artist** button opens a search dialog. Enter an artist name and select **Search** to see matching Spotify artists, then select an artist to start playback of that artist's catalog (Spotify's equivalent of "artist radio") on the currently active device.

Winamp Mode is not currently exposed in the player controls. Its renderer and implementation notes below are retained for maintainers.

iPad2Spotify is a remote: Spotify plays the audio on another device, and the Spotify Web API only provides playback state and commands, not the audio stream. Winamp Mode is designed around that rather than imitating a local player:

- **Main window** — elapsed time (tap for remaining time), play/pause/stop indicator, a scrolling title marquee, position bar and the transport buttons. Previous/Play/Pause/Next send Spotify commands; Pause toggles like Winamp's, and Stop pauses Spotify because Spotify has no stop. Eject opens the artist/playlist search. Volume, balance, shuffle and repeat are shown but not controllable, since the command API does not include them.
- **Visualizer** — the analyzer (tap to cycle analyzer, oscilloscope and off) and the Milkdrop window are driven by a deterministic pseudo-spectrum computed from the track ID, tempo-like beat patterns and the playback position. The same moment of a song always looks the same; it animates while playing, freezes when paused, and fades out when nothing is playing. It is not audio-reactive: Spotify's audio is not available to web pages, and Spotify's developer policy does not allow synchronizing its recordings with visuals.
- **Equalizer** — ten bands plus preamp, ON, AUTO (a deterministic preset per track) and PRESETS (Winamp's built-in presets). The EQ shapes the visualizers only; it cannot change Spotify's sound. Settings are saved on the device.
- **Playlist** — the tracks seen during this session, newest last, with the current track highlighted. It is a history, not Spotify's queue.
- **Milkdrop** — toggle with the clutter bar's **V** button or the window's close button. It uses WebGL when available and a 2D canvas otherwise, rendering at about 30 fps while playing and not at all while paused or hidden.

The windows start in Winamp's default docked layout (Milkdrop beside them in landscape, below in portrait), scaled to fit the screen. Like in Webamp, every window can be dragged by its title bar or frame: windows snap to each other and to the screen edges, dragging the main window brings the windows docked to it along, and the positions are saved on the device.

The button in the main window's top-left corner opens the main menu:

- **Search artist/playlist...** and toggles for the Equalizer, Playlist Editor and Milkdrop windows.
- **Set background...** — pick a local image to show behind the windows. It is downscaled, stored as a base64 JPEG in `localStorage` on the device and restored next time; **Remove background** clears it. If the image cannot be saved (for example in Private Browsing), it is only used until the page is reloaded.
- **Options** — time elapsed/remaining, visualization mode, and **Reset window positions**.
- **Exit** — leaves Winamp Mode.

Playback controls generally require a Spotify Premium account and an active controllable Spotify device. The dashboard does not play audio itself.

## Vercel endpoints

- `/api/auth/login` — starts Spotify authorization
- `/api/auth/callback` — exchanges the authorization code and creates a pairing code
- `/api/auth/pair` — claims a one-time pairing code
- `/api/auth/logout` — clears the session cookie
- `/api/spotify/currently-playing` — returns playback state (no Redis access)
- `/api/spotify/command` — allowlisted play, pause, next, previous, and play_artist (artist radio) commands
- `/api/spotify/search-artist` — searches Spotify for artists by name
- `/api/spotify/search-playlist` — searches Spotify for playlists without using the session KV/Redis helper
- `/api/badge/create` — creates or refreshes the account's public badge (`/api/badge/<spotify-user-id>.svg`)
- `/api/badge/<key>.svg` — returns the public GitHub-compatible SVG card

## Public-service notice and hardening

This is an independent hobby project and is **not operated, sponsored, endorsed, or maintained by Spotify**. Spotify is a trademark of Spotify AB. This project uses Spotify’s public Web API under the account holder’s own authorization and is not an official Spotify client.

If you deploy this repository publicly, visitors can use your Vercel deployment and shared Spotify Developer application. They may consume Vercel Function invocations, Redis operations, and Spotify API quota. The included API applies lightweight Redis-backed per-IP limits to login starts, OAuth callbacks, pairing attempts, and badge creation, plus best-effort in-memory per-instance limits to playback polling and playback commands (so that polling never costs Redis commands). Badge requests are protected by CDN caching. These limits reduce casual abuse but are not a complete DDoS or identity system; monitor your Vercel and Redis usage and disable or protect the deployment if it is abused.

The **Disconnect** button asks for confirmation, then calls `/api/auth/logout` and clears the encrypted session cookie. Users should also revoke this app from their Spotify account settings if they want to remove its authorization completely.

A public badge reveals the selected account’s current or most recently played track metadata and album artwork. Do not create a public badge if that listening information should remain private.

Before making a repository public, audit the complete Git history for credentials. Environment variables must remain only in Vercel. If a secret has ever been committed, rotate it even if the file was later deleted.

The deployment includes security hardening headers (Content Security Policy, HSTS, X-Content-Type-Options, X-Frame-Options, and Referrer-Policy) applied via `vercel.json` on static routes and programmatically on API responses. These mitigate XSS, clickjacking, MIME-sniffing, and protocol-downgrade attacks.

## iPad 2 compatibility

The frontend intentionally avoids `fetch`, ES modules, promises, `async`/`await`, `let` and `const`, service workers, Web Crypto requirements, and modern build-tool dependencies.

It uses ES5 JavaScript, `XMLHttpRequest`, old Safari-safe markup, and iOS Home Screen metadata. Vercel Functions run server-side and are independent of the iPad’s old JavaScript engine.

The Home Screen icon (`apple-touch-icon`, 76 px for iPad 2 up to 180 px) and favicon are generated by `python3 scripts/build-icons.py` (needs Pillow). If an icon was already added to the Home Screen as a page screenshot, remove it and use **Add to Home Screen** again; iOS only reads the icon when the shortcut is created.

## Limitations

Vercel cannot force interactive Spotify login to remain inside an iOS 9 standalone Home Screen window. The pairing flow is intentional: login takes place in normal Safari or another browser, and the authenticated session is then transferred to the fullscreen app using a one-time code.

Adaptive polling and the hidden-page pause can delay visible updates on the iPad; use the refresh icon when an immediate check is needed. Badge updates can be delayed by up to five minutes of CDN caching plus GitHub image caching.

GitHub Pages alone cannot safely store the Spotify Client Secret or maintain the shared pairing/session state required by this flow.

## License

MIT.

## Important: shared public deployment versus your own fork

The public URL `https://ipad2spotify.vercel.app/` is a shared deployment operated by the repository owner. It is convenient for trying the app, but it means your Spotify authorization request and OAuth callback pass through that owner’s Vercel Functions. The resulting refresh token is stored in a cookie encrypted with that deployment's secret (and, if you create a badge, in the Redis database connected to that deployment), and playback requests are processed there. The Client Secret is not sent to your browser, but the deployment owner controls the server code, environment configuration, logs, storage account, and future updates.

**No guarantee is made about the safety or availability of Spotify accounts authorized through the shared deployment.** Do not use the shared URL if you are not comfortable trusting its operator with the server-side handling of your Spotify authorization session. This project is an independent hobby project, not operated by Spotify, and the public deployment may change, be disabled, or be abused by third parties.

For better security and control, fork the repository and deploy your own copy to your own Vercel project. With a self-hosted deployment:

- your own Spotify Developer app supplies the Client ID and Client Secret;
- OAuth callbacks go to your Vercel project rather than the shared deployment;
- your own Upstash Redis database stores pairing records and badge mappings;
- your Spotify refresh tokens remain under your Vercel/Redis account and configuration;
- you control source-code changes, environment-variable access, logs, domains, rate limits, and deletion of stored badge records;
- you can revoke or rotate your own Spotify and Redis credentials without affecting other users.

Self-hosting does not remove all risk: Vercel, Upstash, Spotify, GitHub, and your own configuration remain part of the trust chain. It does, however, remove the repository owner’s shared server and storage from the OAuth path and gives you substantially better control over your credentials and data.

For personal use, the recommended setup is to fork the repository, create your own Spotify Developer app, create your own Upstash Redis database, add your own Vercel environment variables, and use your own production URL. Follow the [Fork and deploy your own copy](#fork-and-deploy-your-own-copy) instructions above.
