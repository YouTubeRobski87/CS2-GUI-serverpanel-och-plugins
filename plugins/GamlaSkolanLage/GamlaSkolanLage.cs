using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Commands;
using CounterStrikeSharp.API.Modules.Timers;
using CounterStrikeSharp.API.Modules.Utils;

namespace GamlaSkolanLage;

// Omröstning om spelläge. Vid matchslut (eller med !lage) får spelarna rösta på
// Retakes / Deathmatch / 1v1 Arenas. Vinner ett annat läge skickas en begäran till
// Gamla Skolan-panelen, som startar om servern i det nya läget.
public class LageConfig : BasePluginConfig
{
    // Servernamnet som syns i serverlistan. Sätts vid varje kartstart (server.cfg skriver annars över det).
    [JsonPropertyName("Hostname")] public string Hostname { get; set; } = "CS2 Multimode – Retakes • DM • 1v1";
    [JsonPropertyName("Prefix")] public string Prefix { get; set; } = "{gold}[Server]{default}";
    // "en" eller "sv"
    [JsonPropertyName("Language")] public string Language { get; set; } = "en";
    // Antal bottar som spelar när ingen människa är inne (0 = av). Bottarna syns som bottar i serverlistan.
    [JsonPropertyName("IdleBots")] public int IdleBots { get; set; } = 0;
}

[MinimumApiVersion(375)]
public class GamlaSkolanLagePlugin : BasePlugin, IPluginConfig<LageConfig>
{
    public LageConfig Config { get; set; } = new();
    public void OnConfigParsed(LageConfig config) => Config = config;

    public override string ModuleName => "Gamla Skolan Lägesomröstning";
    public override string ModuleVersion => "1.5.1";
    public override string ModuleAuthor => "Gamla Skolan";
    public override string ModuleDescription => "Vote for game mode: !mode / !lage";

    private const int VoteSeconds = 20;
    private const int CooldownSeconds = 180;
    private const int AnnounceSeconds = 7;

    private static readonly (string id, string name, string dir)[] Modes =
    {
        ("retakes", "Retakes", "RetakesPlugin"),
        ("deathmatch", "Deathmatch", "Deathmatch"),
        ("arenas", "1v1 Arenas", "K4-Arenas"),
        ("zombie", "Zombie", "ZombieMode"),
    };

    private string P => Config.Prefix
        .Replace("{gold}", $"{ChatColors.Gold}").Replace("{default}", $"{ChatColors.Default}")
        .Replace("{green}", $"{ChatColors.Green}").Replace("{red}", $"{ChatColors.Red}")
        .Replace("{lightred}", $"{ChatColors.LightRed}").Replace("{blue}", $"{ChatColors.Blue}");
    private bool Sv => string.Equals(Config.Language, "sv", StringComparison.OrdinalIgnoreCase);
    private string T(string sv, string en) => Sv ? sv : en;

    private bool _voting;
    private DateTime _voteEnds;
    private DateTime _lastVote = DateTime.MinValue;
    private string _current = "";
    private List<(string id, string name)> _options = new();
    private readonly Dictionary<ulong, string> _votes = new();
    private CounterStrikeSharp.API.Modules.Timers.Timer? _voteTimer;
    private DateTime _announceUntil = DateTime.MinValue;
    private string _announceHtml = "";
    private bool _switching;

    public override void Load(bool hotReload)
    {
        RegisterListener<Listeners.OnTick>(OnTick);
        RegisterListener<Listeners.OnMapStart>(_ =>
        {
            _switching = false;
            // Lägets configar (t.ex. retakes.cfg ca 1 s efter kartstart) skriver över bott-inställningarna.
            // Är servern tom sparas deras värden på nytt och tomt-läget läggs på igen.
            if (_idle || _wanted > 0) AddTimer(4f, () => { if (_idle || _wanted > 0) { SaveModeBotCvars(); ApplyIdleBotCvars(); } }, TimerFlags.STOP_ON_MAPCHANGE);
            // Efter att server.cfg och lägets configar har körts.
            AddTimer(3f, ApplyHostname, TimerFlags.STOP_ON_MAPCHANGE);
            AddTimer(15f, ApplyHostname, TimerFlags.STOP_ON_MAPCHANGE);
        });
        AddTimer(1f, ApplyHostname);
        if (Config.IdleBots > 0) Server.ExecuteCommand("sv_hibernate_when_empty 0");
        AddTimer(5f, IdleBotsCheck, TimerFlags.REPEAT);
    }

    // ---------------------------------------------------------------- bottar när servern är tom
    private bool _idle;
    private string _savedQuota = "", _savedMode = "", _savedJoinAfter = "";

    private static string Cvar(string name)
    {
        try { return CounterStrikeSharp.API.Modules.Cvars.ConVar.Find(name)?.StringValue ?? ""; } catch { return ""; }
    }

    private int _missingChecks;
    private int _lowChecks;
    private int _wanted; // antal bottar vi vill ha just nu (0 = lägets egna inställningar gäller)

    private int TargetBots => Math.Clamp(Config.IdleBots, 1, 20);

    private static int BotCount() =>
        Utilities.GetPlayers().Count(p => p is { IsValid: true, IsBot: true, IsHLTV: false });

    private void SaveModeBotCvars()
    {
        _savedQuota = Cvar("bot_quota"); _savedMode = Cvar("bot_quota_mode"); _savedJoinAfter = Cvar("bot_join_after_player");
    }

    // "normal" = exakt så många bottar oavsett antal människor; fill/join_after_player kräver ofta en människa.
    private void ApplyBotCvars(int count)
    {
        if (Cvar("bot_join_after_player") != "0") Server.ExecuteCommand("bot_join_after_player 0");
        if (Cvar("bot_quota_mode") != "normal") Server.ExecuteCommand("bot_quota_mode normal");
        if (Cvar("bot_quota") != count.ToString()) Server.ExecuteCommand($"bot_quota {count}");
    }

    private void ApplyIdleBotCvars() => ApplyBotCvars(_wanted > 0 ? _wanted : TargetBots);

    // Hur många bottar lägets egna inställningar skulle ge med så här många människor.
    private int ModeBots(int humans)
    {
        int.TryParse(_savedQuota, out var q);
        return _savedMode switch
        {
            "fill" => Math.Max(0, q - humans),
            "match" => q * humans,
            _ => q
        };
    }

    // 1v1 Arenas sköter sina bottar själv (K4-Arenas-Bots).
    private bool FillAllowed() => CurrentMode() != "arenas";

    private void IdleBotsCheck()
    {
        if (Config.IdleBots <= 0) return;
        try
        {
            // Viloläge skulle pausa allt (även den här kollen), så det stängs av när funktionen används.
            if (Cvar("sv_hibernate_when_empty") != "0") Server.ExecuteCommand("sv_hibernate_when_empty 0");
            int humans = Humans().Count;

            if (!_idle && _wanted == 0) SaveModeBotCvars(); // lägets egna värden, innan vi ändrar något

            // Tom server: N bottar. Få spelare: fyll upp till N totalt, om läget självt skulle ge färre.
            // Vi räknar de bottar som faktiskt finns: lägets inställningar kan se ut att ge bottar
            // (t.ex. quota 10 fill i Zombie) men i praktiken ge noll.
            int wanted = 0;
            if (humans == 0) wanted = TargetBots;
            else if (humans < TargetBots && FillAllowed())
            {
                if (_wanted > 0) wanted = TargetBots - humans;                // vi fyller redan – fortsätt
                else if (BotCount() < TargetBots - humans && ++_lowChecks >= 2) // för få i ~10 s
                    wanted = TargetBots - humans;
            }
            if (wanted > 0 || humans >= TargetBots || humans == 0) _lowChecks = 0;

            if (wanted > 0)
            {
                if (_wanted == 0 && !_idle)
                    Logger.LogInformation(humans == 0
                        ? "Tom server: {Count} bottar spelar tills någon ansluter (sparat: quota {Q}, mode {M}, join_after {J})"
                        : "Få spelare: fyller på med {Count} bottar (sparat: quota {Q}, mode {M}, join_after {J})",
                        wanted, _savedQuota, _savedMode, _savedJoinAfter);
                _idle = humans == 0;
                if (wanted != _wanted) _missingChecks = 0;
                _wanted = wanted;
                // Lägg på igen varje kontroll – en config eller ett annat plugin kan ha ändrat värdena.
                ApplyBotCvars(wanted);

                int bots = BotCount();
                if (bots < wanted)
                {
                    _missingChecks++;
                    if (_missingChecks >= 2)
                    {
                        // Motorn fyller inte på av sig själv – lägg till de som saknas för hand.
                        int add = Math.Min(wanted - bots, 5);
                        for (int k = 0; k < add; k++)
                            Server.ExecuteCommand((bots + k) % 2 == 0 ? "bot_add_ct" : "bot_add_t");
                        if (_missingChecks == 2 || _missingChecks % 12 == 0)
                            Logger.LogWarning("Bara {Bots}/{Target} bottar – lägger till {Add} (quota {Q}, mode {M}, join_after {J}, hibernate {H})",
                                bots, wanted, add, Cvar("bot_quota"), Cvar("bot_quota_mode"), Cvar("bot_join_after_player"), Cvar("sv_hibernate_when_empty"));
                    }
                }
                else _missingChecks = 0;
            }
            else if (_idle || _wanted > 0)
            {
                _idle = false;
                _wanted = 0;
                if (_savedJoinAfter != "") Server.ExecuteCommand($"bot_join_after_player {_savedJoinAfter}");
                if (_savedMode != "") Server.ExecuteCommand($"bot_quota_mode {_savedMode}");
                if (_savedQuota != "") Server.ExecuteCommand($"bot_quota {_savedQuota}");
                Logger.LogInformation("Tillräckligt många spelare: bottar tillbaka till lägets inställningar");
            }
        }
        catch (Exception ex) { Logger.LogWarning("Bottkoll misslyckades: {Msg}", ex.Message); }
    }

    private void ApplyHostname()
    {
        var name = (Config.Hostname ?? "").Replace("\"", "'").Trim();
        if (name.Length == 0) return;
        Server.ExecuteCommand($"hostname \"{name}\"");
    }

    // ---------------------------------------------------------------- läge

    private string CurrentMode()
    {
        var pluginsDir = Path.GetFullPath(Path.Combine(ModuleDirectory, ".."));
        foreach (var m in Modes)
            if (Directory.Exists(Path.Combine(pluginsDir, m.dir))) return m.id;
        return "";
    }

    private static string NameOf(string id) => Modes.FirstOrDefault(m => m.id == id).name ?? id;

    private static List<CCSPlayerController> Humans() => Utilities.GetPlayers()
        .Where(p => p != null && p.IsValid && !p.IsBot && !p.IsHLTV && p.Connected == PlayerConnectedState.Connected)
        .ToList();

    // ---------------------------------------------------------------- start

    [GameEventHandler]
    public HookResult OnMatchEnd(EventCsWinPanelMatch e, GameEventInfo info)
    {
        // Matchen är slut – fråga om spelarna vill byta läge innan nästa karta.
        Server.NextFrame(() => StartVote(null, auto: true));
        return HookResult.Continue;
    }

    [ConsoleCommand("css_lage", "Vote for game mode")]
    [ConsoleCommand("css_mode", "Vote for game mode")]
    [CommandHelper(whoCanExecute: CommandUsage.CLIENT_ONLY)]
    public void OnLageCommand(CCSPlayerController? player, CommandInfo cmd)
    {
        if (player == null || !player.IsValid || player.IsBot) return;
        if (_voting) { OpenVoteMenu(player); return; }
        if (_switching) { player.PrintToChat($" {P} {T("Servern byter redan läge.", "The server is already switching mode.")}"); return; }
        var left = CooldownSeconds - (int)(DateTime.UtcNow - _lastVote).TotalSeconds;
        if (left > 0) { player.PrintToChat($" {P} {T($"Vänta {left} sekunder innan nästa omröstning.", $"Wait {left} seconds before the next vote.")}"); return; }
        StartVote(player, auto: false);
    }

    private void StartVote(CCSPlayerController? starter, bool auto)
    {
        if (_voting || _switching) return;
        var humans = Humans();
        if (humans.Count == 0) return;
        _current = CurrentMode();

        _options = new List<(string, string)>();
        if (_current != "") _options.Add((_current, T($"Fortsätt {NameOf(_current)}", $"Keep {NameOf(_current)}")));
        foreach (var m in Modes) if (m.id != _current) _options.Add((m.id, T($"Byt till {m.name}", $"Switch to {m.name}")));

        _votes.Clear();
        _voting = true;
        _lastVote = DateTime.UtcNow;
        _voteEnds = DateTime.UtcNow.AddSeconds(VoteSeconds);
        // Vid matchslut: vänta med nästa karta tills omröstningen är klar.
        if (auto) Server.ExecuteCommand($"mp_match_restart_delay {VoteSeconds + 8}");

        var keys = $"{ChatColors.Gold}W/S{ChatColors.Default} {T("och", "and")} {ChatColors.Gold}E{ChatColors.Default}";
        if (Sv)
        {
            var who = starter != null ? $"{ChatColors.Green}{starter.PlayerName}{ChatColors.Default} startade en" : "Matchen är slut –";
            Server.PrintToChatAll($" {P} {who} omröstning om spelläge! Välj med {keys} ({VoteSeconds} sek).");
        }
        else
        {
            var who = starter != null ? $"{ChatColors.Green}{starter.PlayerName}{ChatColors.Default} started a" : "Match over –";
            Server.PrintToChatAll($" {P} {who} game mode vote! Pick with {keys} ({VoteSeconds} s).");
        }
        foreach (var h in humans) OpenVoteMenu(h);

        _voteTimer?.Kill();
        _voteTimer = AddTimer(VoteSeconds, FinishVote); // överlever kartbyte
    }

    private void Vote(CCSPlayerController p, string modeId)
    {
        if (!_voting) return;
        _votes[p.SteamID] = modeId;
        CloseMenu(p);
        var humans = Humans().Count;
        Server.PrintToChatAll($" {P} {ChatColors.Green}{p.PlayerName}{ChatColors.Default} {T("röstade", "voted")}: {ChatColors.Gold}{_options.First(o => o.id == modeId).name}{ChatColors.Default} ({_votes.Count}/{humans})");
        if (_votes.Count >= humans) Server.NextFrame(FinishVote); // alla har röstat
    }

    private void FinishVote()
    {
        if (!_voting) return;
        _voting = false;
        _voteTimer?.Kill();
        _voteTimer = null;
        foreach (var h in Humans()) CloseMenu(h);

        // Bara röster från spelare som fortfarande är inne räknas.
        var online = Humans().Select(h => h.SteamID).ToHashSet();
        var counts = _votes.Where(v => online.Contains(v.Key)).GroupBy(v => v.Value).ToDictionary(g => g.Key, g => g.Count());
        if (counts.Count == 0) { Server.PrintToChatAll($" {P} {T($"Ingen röstade – vi kör vidare med {NameOf(_current)}.", $"Nobody voted – we keep playing {NameOf(_current)}.")}"); return; }

        int stay = counts.GetValueOrDefault(_current, 0);
        var best = counts.Where(c => c.Key != _current).OrderByDescending(c => c.Value).FirstOrDefault();
        bool tieAmongChallengers = best.Key != null && counts.Count(c => c.Key != _current && c.Value == best.Value) > 1;

        if (best.Key == null || best.Value <= stay || tieAmongChallengers)
        {
            Server.PrintToChatAll($" {P} {T("Omröstningen är klar – vi kör vidare med", "Vote finished – we keep playing")} {ChatColors.Green}{NameOf(_current)}{ChatColors.Default}.");
            return;
        }
        SwitchTo(best.Key, best.Value);
    }

    private void SwitchTo(string modeId, int votes)
    {
        _switching = true;
        var name = NameOf(modeId);
        if (Sv)
        {
            Server.PrintToChatAll($" {P} {ChatColors.Green}{name}{ChatColors.Default} vann med {votes} röst{(votes == 1 ? "" : "er")}!");
            Server.PrintToChatAll($" {P} {ChatColors.Red}Servern restartar för nya läget: {name}.{ChatColors.Default} Återanslut om ca 30 sekunder via {ChatColors.Gold}Senaste{ChatColors.Default} eller {ChatColors.Gold}Favoriter{ChatColors.Default} i serverlistan.");
        }
        else
        {
            Server.PrintToChatAll($" {P} {ChatColors.Green}{name}{ChatColors.Default} won with {votes} vote{(votes == 1 ? "" : "s")}!");
            Server.PrintToChatAll($" {P} {ChatColors.Red}The server is restarting for the new mode: {name}.{ChatColors.Default} Reconnect in about 30 seconds via {ChatColors.Gold}Recent{ChatColors.Default} or {ChatColors.Gold}Favorites{ChatColors.Default} in the server browser.");
        }
        _announceHtml =
            $"<font color='#f5a524' class='fontSize-l'>{T("Servern restartar för nya läget", "Server restarting for the new mode")}</font><br>" +
            $"<font color='#7CFC00' class='fontSize-xl'>{name}</font><br>" +
            $"<font color='#ffffff'>{T("Återanslut om ca 30 sekunder via Senaste eller Favoriter i serverlistan", "Reconnect in about 30 seconds via Recent or Favorites in the server browser")}</font>";
        _announceUntil = DateTime.UtcNow.AddSeconds(AnnounceSeconds);

        AddTimer(AnnounceSeconds - 1, () =>
        {
            try
            {
                var dir = Path.GetFullPath(Path.Combine(ModuleDirectory, "..", "..", "data", "gs_panel", "requests"));
                Directory.CreateDirectory(dir);
                var file = Path.Combine(dir, "mode.json");
                File.WriteAllText(file + ".tmp", JsonSerializer.Serialize(new { mode = modeId, t = DateTime.UtcNow, by = "vote" }));
                File.Move(file + ".tmp", file, true);
                Logger.LogInformation("Begärde lägesbyte till {Mode}", modeId);
            }
            catch (Exception ex)
            {
                _switching = false;
                Logger.LogError("Kunde inte skicka lägesbyte: {Msg}", ex.Message);
                Server.PrintToChatAll($" {P} {ChatColors.Red}{T("Kunde inte byta läge – är panelen igång?", "Could not switch mode – is the panel running?")}");
            }
        });

        // Om panelen inte svarar inom en minut: säg till och släpp spärren.
        AddTimer(60f, () =>
        {
            if (!_switching) return;
            _switching = false;
            Server.PrintToChatAll($" {P} {ChatColors.Red}{T("Lägesbytet blev inte av – panelen verkar inte vara igång.", "The mode switch did not happen – the panel does not seem to be running.")}");
        });
    }

    // ---------------------------------------------------------------- meny (W/S, E, R)

    private class MenuState
    {
        public int Sel;
        public PlayerButtons Last;
    }

    private readonly Dictionary<int, MenuState> _menus = new();

    private void OpenVoteMenu(CCSPlayerController player)
    {
        if (_votes.ContainsKey(player.SteamID)) { player.PrintToChat($" {P} {T("Du har redan röstat.", "You have already voted.")}"); return; }
        _menus[player.Slot] = new MenuState { Sel = 0, Last = player.Buttons };
    }

    private void CloseMenu(CCSPlayerController player)
    {
        if (_menus.Remove(player.Slot)) player.PrintToCenterHtml(" ");
    }

    private static string Esc(string s) => s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;");

    private void OnTick()
    {
        if (DateTime.UtcNow < _announceUntil)
        {
            foreach (var h in Humans()) h.PrintToCenterHtml(_announceHtml);
            return;
        }
        if (!_voting || _menus.Count == 0) return;

        int secs = Math.Max(0, (int)Math.Ceiling((_voteEnds - DateTime.UtcNow).TotalSeconds));
        foreach (var slot in _menus.Keys.ToList())
        {
            if (!_menus.TryGetValue(slot, out var m)) continue;
            var p = Utilities.GetPlayerFromSlot(slot);
            if (p == null || !p.IsValid || p.IsBot) { _menus.Remove(slot); continue; }

            var now = p.Buttons;
            var pressed = now & ~m.Last;
            m.Last = now;

            if ((pressed & PlayerButtons.Forward) != 0) m.Sel = (m.Sel - 1 + _options.Count) % _options.Count;
            else if ((pressed & PlayerButtons.Back) != 0) m.Sel = (m.Sel + 1) % _options.Count;
            else if ((pressed & PlayerButtons.Use) != 0) { Vote(p, _options[m.Sel].id); continue; }
            else if ((pressed & PlayerButtons.Reload) != 0) { CloseMenu(p); p.PrintToChat(T($" {P} Skriv {ChatColors.Gold}!lage{ChatColors.Default} för att öppna omröstningen igen.", $" {P} Type {ChatColors.Gold}!mode{ChatColors.Default} to open the vote again.")); continue; }

            var sb = new System.Text.StringBuilder();
            sb.Append($"<font color='#f5a524' class='fontSize-m'>{T("Vilket läge vill du köra?", "Which mode do you want?")} ({secs})</font><br>");
            for (int i = 0; i < _options.Count; i++)
            {
                var text = Esc(_options[i].name);
                sb.Append(i == m.Sel ? $"<font color='#7CFC00'>▶ {text}</font><br>" : $"<font color='#ffffff'>{text}</font><br>");
            }
            sb.Append($"<font color='#9b917f' class='fontSize-s'>{T("W/S: bläddra · E: rösta · R: stäng", "W/S: browse · E: vote · R: close")}</font>");
            p.PrintToCenterHtml(sb.ToString());
        }
    }
}
