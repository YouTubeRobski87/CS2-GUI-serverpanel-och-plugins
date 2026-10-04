# Getting started

*[Svenska → KOM-IGANG.md](KOM-IGANG.md)*

This guide takes you from nothing to a running CS2 server with the panel, about 30–45 minutes the first time.
Everything runs on one Windows PC.

## What you need

| | What | Where |
|---|---|---|
| 1 | **Windows 10/11** PC that can stay on while people play | – |
| 2 | **Node.js 20 or newer** (LTS) – runs the panel | [nodejs.org](https://nodejs.org) |
| 3 | **SteamCMD** – downloads the CS2 dedicated server | [developer.valvesoftware.com/wiki/SteamCMD](https://developer.valvesoftware.com/wiki/SteamCMD) |
| 4 | **Metamod:Source 2.0** (dev build for CS2) | [sourcemm.net/downloads.php?branch=dev](https://www.sourcemm.net/downloads.php?branch=dev) |
| 5 | **CounterStrikeSharp** – the *"with runtime"* Windows zip | [github.com/roflmuffin/CounterStrikeSharp/releases](https://github.com/roflmuffin/CounterStrikeSharp/releases) |
| 6 | **A GSLT token** (free) so the server shows up online | [steamcommunity.com/dev/managegameservers](https://steamcommunity.com/dev/managegameservers) – app id **730** |
| 7 | **The release zip** from this repo | [Releases](https://github.com/YouTubeRobski87/CS2-GUI-serverpanel-och-plugins/releases) |

Plus the game-mode plugins you want (you can start with just one):

| Mode | Plugins | Where |
|---|---|---|
| **Retakes** | RetakesPlugin (+ `RetakesPluginShared` in `shared/`), optional Instadefuse and Clutch Announce | [B3none/cs2-retakes](https://github.com/B3none/cs2-retakes), [cs2-instadefuse](https://github.com/B3none/cs2-instadefuse), [cs2-clutch-announce](https://github.com/B3none/cs2-clutch-announce) |
| **Deathmatch** | Deathmatch + DeathmatchAPI | [NockyCZ/CS2-Deathmatch](https://github.com/NockyCZ/CS2-Deathmatch) |
| **1v1 Arenas** | K4-Arenas (needs MySQL/MariaDB and an arena workshop map) | [K4ryuu/K4-Arenas](https://github.com/K4ryuu/K4-Arenas) |

## 1. Install the CS2 server

1. Unzip SteamCMD to e.g. `C:\SteamCMD`.
2. Open a command prompt there and run:
   ```
   steamcmd +force_install_dir C:\GameServers\CS2 +login anonymous +app_update 730 validate +quit
   ```
   It downloads about 35 GB. When it is done you have `C:\GameServers\CS2\game\bin\win64\cs2.exe`.

## 2. Install Metamod and CounterStrikeSharp

1. Unzip **Metamod** into `C:\GameServers\CS2\game\csgo\` (you get `game\csgo\addons\metamod`).
2. Unzip **CounterStrikeSharp (with runtime)** into the same folder (you get `game\csgo\addons\counterstrikesharp`).
3. Open `game\csgo\gameinfo.gi` and add `Game csgo/addons/metamod` on the line after `Game_LowViolence csgo_lv`.
   (The panel also does this automatically every time it starts the server – CS2 updates remove the line.)

## 3. Copy in the files from the release zip

Unzip `GamlaSkolan-CS2-Panel-vX.Y.Z.zip`. It contains three folders:

| Folder in the zip | Copy to |
|---|---|
| `ServerFiles\game\…` | `C:\GameServers\CS2\game\…` (merge the folders) – this adds the panel's plugins to `addons\counterstrikesharp\plugins` |
| `Panel\` | anywhere you like, e.g. `C:\GameServers\Panel\` |
| `Optional\` | see [Optional extras](#optional-extras) |

Then install the game-mode plugins you picked above into `addons\counterstrikesharp\plugins\` (and `shared\`) as their own instructions say.

## 4. Start the panel

1. In the `Panel` folder, double-click **`Gamla Skolan Panel.vbs`**.
2. The panel opens in its own window and an icon appears by the clock. It also creates a
   **Gamla Skolan Panel** shortcut on your desktop and in the Start menu – use that from now on
   (right-click it in the Start menu to pin it to the taskbar).
3. Language: switch between **English** and **Svenska** at the bottom left. The in-game messages follow.

> Windows SmartScreen or your antivirus may ask about the `.vbs` file the first time. It only starts
> `panel-tray.ps1` from the same folder – you can read both files in Notepad.

## 5. First-time setup in the panel

Go to **Settings → Getting started**. It checks everything for you:

- **CS2 dedicated server** – red? Set *Server folder* under **Panel** to `C:\GameServers\CS2` and save.
- **Metamod / CounterStrikeSharp / Panel bridge plugin** – red? Step 2 or 3 is not done.
- **GSLT token** – paste your token and press *Save token*. It is stored only on your PC
  (`Panel\panel-data\gslt.txt`) and never shown in full.

Then set:

- **Server name** – what people see in the server browser.
- **Chat tag** – e.g. `{gold}[My Server]{default}`, shown in front of every server message.
- **Port** – default `27015`. Open/forward this port (UDP **and** TCP) in your router and Windows
  Firewall if friends outside your home should be able to join.

## 6. Start the server

On **Overview**, pick a mode and press **Start**. A CS2 console window opens – leave it open
(closing the panel does **not** stop the server). After ~30 seconds the status turns *Online*.

Join from CS2: open the console and type `connect <your-public-ip>:27015`
(on the same PC: `connect localhost:27015`). After the first time, it is in *Recent* / *Favorites*.

## Game modes

The panel turns plugins on and off per mode by moving plugin folders into
`C:\GameServers\CS2\_panel_disabled\` – nothing is deleted.

- Built-in modes: **Retakes**, **Deathmatch**, **1v1 Arenas**. Players can vote between them in game
  with **`!mode`** (also automatically at the end of a match); the panel then restarts the server in the new mode.
- **Settings → Game modes**: edit launch arguments, which plugins to enable/disable, the map list –
  or add your own mode (e.g. an aim map). `{port}` and `{gslt}` are filled in for you.
  Add `+exec yourfile.cfg` to the arguments to run your own config.

## In-game commands

| Command | What it does |
|---|---|
| `!guns` / `!vapen` | Weapon menu in Retakes – **W/S** to move, **E** to pick, **A** back, **R** close |
| `!mode` / `!lage` | Start a vote for another game mode |
| `!rank`, `!top` | Your rank / the leaderboard (Deathmatch and Arenas) |

## Optional extras

- `Optional\cs2-retakes\retakes.cfg` – fills Retakes with bots when few players are on. Copy to
  `game\csgo\cfg\cs2-retakes\` (back up your own first if you have one).
- `Optional\swedish-lang\` – Swedish translations for RetakesPlugin, Instadefuse and Clutch Announce.

## Updating

- **CS2 patch**: the panel shows *New CS2 patch available* – stop the server and press **Update** (needs SteamCMD path under Settings).
- **This panel**: download the new release, close the panel (right-click the clock icon → *Quit*),
  replace `build` in your `Panel` folder and the `.dll` files under `addons\counterstrikesharp\plugins`.
  Your settings in `Panel\panel-data` are kept.

## Troubleshooting

| Problem | Fix |
|---|---|
| Nothing happens when I start the panel | Check `Panel\panel-data\tray.log` and `panel.log`. Is Node.js installed (`node -v` in a command prompt)? |
| "Cannot find plugins/RetakesPlugin" when starting | The mode's plugins are not installed – see the table at the top, or edit the mode under Settings. |
| Server starts but the panel says the bridge is not responding | Is `GamlaSkolanPanelBridge` in `addons\counterstrikesharp\plugins`? Type `css_plugins list` in the server console. |
| Server not visible / friends can't join | GSLT set? Port forwarded (UDP+TCP)? Windows Firewall allows `cs2.exe`? |
| After a CS2 update plugins don't load | Start from the panel (it repairs `gameinfo.gi`), and update Metamod/CounterStrikeSharp if a new build is out. |
| 1v1 Arenas says NO_MAP | The arena workshop map has not downloaded – check K4-Arenas' instructions for its map. |
