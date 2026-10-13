# Gamla Skolan – 7 Days to Die-panel

Liten webbpanel för servern i `C:\GameServers\7DaysToDie`. Inga beroenden – bara Node.

- **Starta panelen.bat** – startar panelen i bakgrunden och öppnar http://127.0.0.1:8028
- **Stoppa panelen.bat** – stänger panelen (spelservern påverkas inte)

Flikar: Översikt (starta/stoppa, speldag, nästa horde), Konsol (logg + kommandon via telnet),
Spelare (kicka/banna/gör admin), Inställningar (serverconfig-gamlaskolan.xml), Uppdatera (SteamCMD).

Sökvägar och portar ändras i `panel-data/panel-settings.json`.
Panelen lyssnar bara på den här datorn.
