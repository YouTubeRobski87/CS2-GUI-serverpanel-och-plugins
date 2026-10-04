# Kom igång

*[English → GETTING-STARTED.md](GETTING-STARTED.md)*

Den här guiden tar dig från noll till en CS2-server som körs med panelen – räkna med 30–45 minuter första gången.
Allt körs på en Windows-dator.

## Det här behöver du

| | Vad | Var |
|---|---|---|
| 1 | **Windows 10/11**-dator som kan stå på medan folk spelar | – |
| 2 | **Node.js 20 eller nyare** (LTS) – kör panelen | [nodejs.org](https://nodejs.org) |
| 3 | **SteamCMD** – laddar ner CS2-servern | [developer.valvesoftware.com/wiki/SteamCMD](https://developer.valvesoftware.com/wiki/SteamCMD) |
| 4 | **Metamod:Source 2.0** (dev build för CS2) | [sourcemm.net/downloads.php?branch=dev](https://www.sourcemm.net/downloads.php?branch=dev) |
| 5 | **CounterStrikeSharp** – Windows-zippen *"with runtime"* | [github.com/roflmuffin/CounterStrikeSharp/releases](https://github.com/roflmuffin/CounterStrikeSharp/releases) |
| 6 | **En GSLT-token** (gratis) så att servern syns online | [steamcommunity.com/dev/managegameservers](https://steamcommunity.com/dev/managegameservers) – app-id **730** |
| 7 | **Release-zippen** från det här repot | [Releases](https://github.com/YouTubeRobski87/CS2-GUI-serverpanel-och-plugins/releases) |

Plus plugins för de spellägen du vill köra (det räcker att börja med ett):

| Läge | Plugins | Var |
|---|---|---|
| **Retakes** | RetakesPlugin (+ `RetakesPluginShared` i `shared/`), gärna Instadefuse och Clutch Announce | [B3none/cs2-retakes](https://github.com/B3none/cs2-retakes), [cs2-instadefuse](https://github.com/B3none/cs2-instadefuse), [cs2-clutch-announce](https://github.com/B3none/cs2-clutch-announce) |
| **Deathmatch** | Deathmatch + DeathmatchAPI | [NockyCZ/CS2-Deathmatch](https://github.com/NockyCZ/CS2-Deathmatch) |
| **1v1 Arenas** | K4-Arenas (behöver MySQL/MariaDB och en arena-karta från workshop) | [K4ryuu/K4-Arenas](https://github.com/K4ryuu/K4-Arenas) |

## 1. Installera CS2-servern

1. Packa upp SteamCMD till t.ex. `C:\SteamCMD`.
2. Öppna en kommandotolk där och kör:
   ```
   steamcmd +force_install_dir C:\GameServers\CS2 +login anonymous +app_update 730 validate +quit
   ```
   Det laddar ner ca 35 GB. När det är klart finns `C:\GameServers\CS2\game\bin\win64\cs2.exe`.

## 2. Installera Metamod och CounterStrikeSharp

1. Packa upp **Metamod** i `C:\GameServers\CS2\game\csgo\` (då får du `game\csgo\addons\metamod`).
2. Packa upp **CounterStrikeSharp (with runtime)** i samma mapp (då får du `game\csgo\addons\counterstrikesharp`).
3. Öppna `game\csgo\gameinfo.gi` och lägg till `Game csgo/addons/metamod` på raden efter `Game_LowViolence csgo_lv`.
   (Panelen gör det här automatiskt varje gång den startar servern – CS2-uppdateringar tar bort raden.)

## 3. Kopiera in filerna från release-zippen

Packa upp `GamlaSkolan-CS2-Panel-vX.Y.Z.zip`. Den har tre mappar:

| Mapp i zippen | Kopiera till |
|---|---|
| `ServerFiles\game\…` | `C:\GameServers\CS2\game\…` (slå ihop mapparna) – lägger panelens plugins i `addons\counterstrikesharp\plugins` |
| `Panel\` | var du vill, t.ex. `C:\GameServers\Panel\` |
| `Optional\` | se [Extra (valfritt)](#extra-valfritt) |

Installera sedan plugins för spellägena du valt i `addons\counterstrikesharp\plugins\` (och `shared\`) enligt deras egna instruktioner.

## 4. Starta panelen

1. Dubbelklicka på **`Gamla Skolan Panel.vbs`** i mappen `Panel`.
2. Panelen öppnas i ett eget fönster och en ikon dyker upp vid klockan. Den skapar också genvägen
   **Gamla Skolan Panel** på skrivbordet och i Start-menyn – använd den i fortsättningen
   (högerklicka på den i Start-menyn för att fästa den i aktivitetsfältet).
3. Språk: byt mellan **English** och **Svenska** nere till vänster. Meddelandena i spelet följer med.

> Windows SmartScreen eller antivirus kan fråga om `.vbs`-filen första gången. Den startar bara
> `panel-tray.ps1` i samma mapp – du kan läsa båda filerna i Anteckningar.

## 5. Ställ in panelen första gången

Gå till **Inställningar → Kom igång**. Där kontrolleras allt åt dig:

- **CS2 dedikerad server** – röd? Ställ *Servermapp* under **Panelen** till `C:\GameServers\CS2` och spara.
- **Metamod / CounterStrikeSharp / Panelens bryggplugin** – röd? Steg 2 eller 3 är inte klart.
- **GSLT-token** – klistra in din token och tryck *Spara token*. Den sparas bara på din dator
  (`Panel\panel-data\gslt.txt`) och visas aldrig i klartext.

Ställ sedan in:

- **Servernamn** – det folk ser i serverlistan.
- **Chatt-tagg** – t.ex. `{gold}[Min Server]{default}`, står först i alla meddelanden från servern.
- **Port** – standard `27015`. Öppna/forwarda porten (UDP **och** TCP) i routern och Windows-brandväggen
  om kompisar utanför ditt hem ska kunna ansluta.

## 6. Starta servern

Välj läge på **Översikt** och tryck **Starta**. Ett CS2-konsolfönster öppnas – låt det vara öppet
(servern stängs **inte** om du stänger panelen). Efter ca 30 sekunder blir statusen *Online*.

Anslut från CS2: öppna konsolen och skriv `connect <din-publika-ip>:27015`
(på samma dator: `connect localhost:27015`). Efter första gången finns servern under *Senaste* / *Favoriter*.

## Spellägen

Panelen slår på och av plugins per läge genom att flytta plugin-mappar till
`C:\GameServers\CS2\_panel_disabled\` – inget tas bort.

- Inbyggda lägen: **Retakes**, **Deathmatch**, **1v1 Arenas**. Spelarna kan rösta mellan dem i spelet med
  **`!lage`** (även automatiskt när en match är slut); panelen startar då om servern i det nya läget.
- **Inställningar → Spellägen**: ändra startargument, vilka plugins som slås på/av och kartlistan –
  eller lägg till ett eget läge (t.ex. en aim-karta). `{port}` och `{gslt}` fylls i åt dig.
  Lägg till `+exec dinfil.cfg` i argumenten för att köra en egen config.

## Kommandon i spelet

| Kommando | Vad det gör |
|---|---|
| `!vapen` / `!guns` | Vapenval i Retakes – **W/S** bläddra, **E** välj, **A** tillbaka, **R** stäng |
| `!lage` / `!mode` | Starta en omröstning om annat spelläge |
| `!rank`, `!top` | Din rank / topplistan (Deathmatch och Arenas) |

## Extra (valfritt)

- `Optional\cs2-retakes\retakes.cfg` – fyller Retakes med bottar när få spelare är inne. Kopiera till
  `game\csgo\cfg\cs2-retakes\` (spara din egen först om du har en).
- `Optional\swedish-lang\` – svenska översättningar till RetakesPlugin, Instadefuse och Clutch Announce.

## Uppdatera

- **CS2-patch**: panelen visar *Ny CS2-patch finns* – stoppa servern och tryck **Uppdatera** (kräver SteamCMD-sökväg under Inställningar).
- **Panelen**: ladda ner nya releasen, stäng panelen (högerklicka på ikonen vid klockan → *Avsluta*),
  byt ut `build` i din `Panel`-mapp och `.dll`-filerna under `addons\counterstrikesharp\plugins`.
  Dina inställningar i `Panel\panel-data` ligger kvar.

## Felsökning

| Problem | Lösning |
|---|---|
| Inget händer när jag startar panelen | Kolla `Panel\panel-data\tray.log` och `panel.log`. Är Node.js installerat (`node -v` i en kommandotolk)? |
| "Hittar inte plugins/RetakesPlugin" vid start | Lägets plugins är inte installerade – se tabellen högst upp, eller ändra läget under Inställningar. |
| Servern startar men panelen säger att bryggan inte svarar | Ligger `GamlaSkolanPanelBridge` i `addons\counterstrikesharp\plugins`? Skriv `css_plugins list` i serverkonsolen. |
| Servern syns inte / kompisar kommer inte in | GSLT inlagd? Port forwardad (UDP+TCP)? Släpper Windows-brandväggen igenom `cs2.exe`? |
| Plugins laddas inte efter en CS2-uppdatering | Starta från panelen (den lagar `gameinfo.gi`), och uppdatera Metamod/CounterStrikeSharp om det finns ny build. |
| 1v1 Arenas säger NO_MAP | Arena-kartan från workshop har inte laddats ner – se K4-Arenas instruktioner för kartan. |
