using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Admin;
using CounterStrikeSharp.API.Modules.Commands;
using CounterStrikeSharp.API.Modules.Utils;
using CounterStrikeSharp.API.Modules.Entities.Constants;
using Microsoft.Extensions.Logging;

namespace GamlaSkolanZombieMenu;

public class ZombieMenuConfig : BasePluginConfig
{
    [JsonPropertyName("Prefix")] public string Prefix { get; set; } = "{gold}[Server]{default}";
    // "en" eller "sv"
    [JsonPropertyName("Language")] public string Language { get; set; } = "en";

    // Zombiebanor från Steam Workshop, "namn=workshop-id" (samma format som panelens kartlista; "@" går också).
    // Används vid matchslut när minst MinHumansForZm riktiga spelare är inne.
    [JsonPropertyName("ZombieMaps")] public List<string> ZombieMaps { get; set; } = new()
    {
        "zm_mirage=3347415049",
        "zm_ice_attack=3399305351",
        "zm_lila_panic=3226022150",
        "zm_prisonbreak=3648327879",
        "zm_cs2_baggage=3377791997",
        "zm_dust2_rebuild_b1_p=3326291211",
        "zm_nuke_classic=3640585624",
        "zm_3rooms=3101494948",
        "zm_fox_v2=3381887875",
        "zm_rats_1337_classic=3432802694",
        "zm_iceworld_v2_1_p=3329108662",
        "zm_dust_world=3610087255",
    };
    [JsonPropertyName("MapRotation")] public bool MapRotation { get; set; } = true;
    // Vanliga banor (med stöd för bottar) som används när färre än MinHumansForZm spelare är inne.
    [JsonPropertyName("BotMaps")] public List<string> BotMaps { get; set; } = new() { "de_dust2", "cs_italy", "cs_office", "de_inferno", "de_mirage" };
    [JsonPropertyName("MinHumansForZm")] public int MinHumansForZm { get; set; } = 2;
}

// Adminmeny för cs2-zombie-mode: !zm. Ändrar ZombieMode.json och kan be panelen starta om servern,
// eftersom zombie-pluginet bara läser sin config när det laddas.
[MinimumApiVersion(375)]
public class GamlaSkolanZombieMenuPlugin : BasePlugin, IPluginConfig<ZombieMenuConfig>
{
    public override string ModuleName => "Gamla Skolan Zombie Menu";
    public override string ModuleVersion => "1.7.0";
    public override string ModuleAuthor => "Gamla Skolan";
    public override string ModuleDescription => "Admin menu for cs2-zombie-mode settings (!zm) and no warmup in Zombie mode";

    public ZombieMenuConfig Config { get; set; } = new();
    public void OnConfigParsed(ZombieMenuConfig config) => Config = config;

    private bool Sv => string.Equals(Config.Language, "sv", StringComparison.OrdinalIgnoreCase);
    private string T(string sv, string en) => Sv ? sv : en;
    private string P => Config.Prefix
        .Replace("{gold}", $"{ChatColors.Gold}").Replace("{default}", $"{ChatColors.Default}")
        .Replace("{green}", $"{ChatColors.Green}").Replace("{red}", $"{ChatColors.Red}")
        .Replace("{lightred}", $"{ChatColors.LightRed}").Replace("{blue}", $"{ChatColors.Blue}");

    private record Field(string Path, string Sv, string En, double Min, double Max, double Step, double Def);

    private static readonly Field[] Fields =
    {
        new("infection.roundLimitSeconds", "Rundtid (s)", "Round time (s)", 120, 1800, 30, 420),
        new("infection.hpBase", "Zombie-HP", "Zombie HP", 100, 10000, 100, 1500),
        new("infection.hpPerHuman", "HP per människa", "HP per human", 0, 1000, 25, 100),
        new("infection.firstInfectedMultiplier", "Första zombien ×", "First infected ×", 1, 6, 0.25, 2.5),
        new("knockback.multiplier", "Knockback", "Knockback", 0, 20, 0.5, 6),
        new("infection.bleedDamage", "Blödning", "Bleeding", 1, 30, 1, 5),
        new("infection.leapCooldown", "Hopp-nedkylning (s)", "Leap cooldown (s)", 1, 30, 1, 8),
        new("infection.minToStart", "Minst spelare", "Min players", 1, 20, 1, 2),
    };

    private class MenuState
    {
        public int Sel;
        public PlayerButtons Last;
        public JsonNode? Json;
        public double[] Values = Array.Empty<double>();
        public bool Dirty;
        public DateTime Opened = DateTime.UtcNow;
    }

    private readonly Dictionary<int, MenuState> _menus = new();

    private string ZombieFile => Path.GetFullPath(Path.Combine(ModuleDirectory, "..", "..", "configs", "plugins", "ZombieMode", "ZombieMode.json"));

    public override void Load(bool hotReload)
    {
        RegisterListener<Listeners.OnTick>(OnTick);
        // Ingen warmup i Zombie: CS2:s lägesconfigar slår på den vid varje kartstart, så vi avslutar den direkt.
        AddTimer(2f, NoWarmup, CounterStrikeSharp.API.Modules.Timers.TimerFlags.REPEAT);
        RegisterListener<Listeners.OnMapStart>(OnMapStartRotation);
        AddTimer(10f, BotlessCheck, CounterStrikeSharp.API.Modules.Timers.TimerFlags.REPEAT);
    }

    // ---------------------------------------------------------------- zombiebanor (workshop)
    // De flesta zm_-banor från Workshop saknar navigeringsnät, så bottar kan inte spela där.
    // Därför: zm_-banor när minst MinHumansForZm riktiga spelare är inne, annars en vanlig bana med bottar.
    private bool _switching;
    private int _noBotChecks;

    private List<(string name, string id)> ZmMaps => Config.ZombieMaps
        .Select(m => m.Split(new[] { '@', '=' }, 2))
        .Where(a => a.Length == 2 && a[1].Trim().All(char.IsDigit) && a[1].Trim().Length >= 6)
        .Select(a => (a[0].Trim(), a[1].Trim()))
        .ToList();

    private List<string> BotMaps => Config.BotMaps.Where(m => !string.IsNullOrWhiteSpace(m)).Select(m => m.Trim()).ToList();

    private static int HumanCount() => Utilities.GetPlayers().Count(p => p is { IsValid: true, IsBot: false, IsHLTV: false } && p.Connected == PlayerConnectedState.Connected);
    private static int BotCountNow() => Utilities.GetPlayers().Count(p => p is { IsValid: true, IsBot: true, IsHLTV: false });

    private bool OnZmMap => ZmMaps.Any(m => string.Equals(m.name, Server.MapName, StringComparison.OrdinalIgnoreCase))
                            || Server.MapName.StartsWith("zm_", StringComparison.OrdinalIgnoreCase);

    private void OnMapStartRotation(string map)
    {
        _switching = false;
        _noBotChecks = 0;
        _emptyChecks = 0;
    }

    // ---- vilka zm_-banor klarar bottar? Servern testar själv och sparar svaret i zm_botmaps.json.
    private int _emptyChecks;
    private Dictionary<string, bool>? _botOk;
    private string BotOkFile => Path.Combine(ModuleDirectory, "zm_botmaps.json");

    private Dictionary<string, bool> BotOk
    {
        get
        {
            if (_botOk != null) return _botOk;
            try { _botOk = JsonSerializer.Deserialize<Dictionary<string, bool>>(File.ReadAllText(BotOkFile)); } catch { }
            return _botOk ??= new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
        }
    }

    private void MarkBots(string map, bool ok)
    {
        if (BotOk.TryGetValue(map, out var cur) && cur == ok) return;
        if (cur && !ok) return; // har funkat förut – en tom stund ändrar inte det
        BotOk[map] = ok;
        try { File.WriteAllText(BotOkFile, JsonSerializer.Serialize(BotOk, new JsonSerializerOptions { WriteIndented = true })); } catch { }
        Logger.LogInformation("Zombie: {Map} {Res}", map, ok ? "klarar bottar" : "klarar INTE bottar (inget navigeringsnät)");
    }

    private List<(string name, string id)> ZmWithBots => ZmMaps.Where(m => BotOk.TryGetValue(m.name, out var ok) && ok).ToList();
    private List<(string name, string id)> ZmUntested => ZmMaps.Where(m => !BotOk.ContainsKey(m.name)).ToList();

    private (string name, string id)? PickOther(List<(string name, string id)> list)
    {
        var l = list.Where(m => !string.Equals(m.name, Server.MapName, StringComparison.OrdinalIgnoreCase)).ToList();
        return l.Count == 0 ? null : l[Random.Shared.Next(l.Count)];
    }

    private (string name, string id) BotFallback()
    {
        var good = PickOther(ZmWithBots);
        if (good != null) return good.Value;
        var bm = BotMaps.Where(m => !string.Equals(m, Server.MapName, StringComparison.OrdinalIgnoreCase)).ToList();
        return (bm.Count > 0 ? bm[Random.Shared.Next(bm.Count)] : "de_dust2", "");
    }

    // Var 10:e sekund.
    private void BotlessCheck()
    {
        if (!Config.MapRotation || _switching) return;
        int humans = HumanCount(), bots = BotCountNow();
        int min = Math.Max(1, Config.MinHumansForZm);

        if (OnZmMap)
        {
            if (bots > 0) { MarkBots(Server.MapName, true); _noBotChecks = 0; return; }
            if (humans >= min) { _noBotChecks = 0; return; } // tillräckligt många riktiga spelare – bottar behövs inte
            bool knownGood = BotOk.TryGetValue(Server.MapName, out var ok) && ok;
            if (++_noBotChecks < (knownGood ? 6 : 3)) return; // ~30 s (60 s för en bana som funkat förut)
            MarkBots(Server.MapName, false);
            var pick = humans == 0 && ZmUntested.Count > 0 ? PickOther(ZmUntested)!.Value : BotFallback();
            if (humans > 0)
                Server.PrintToChatAll($" {P} {T($"Bottar funkar inte på den här banan – byter till {ChatColors.Green}{pick.name}{ChatColors.Default}.", $"Bots can't play this map – switching to {ChatColors.Green}{pick.name}{ChatColors.Default}.")}");
            AddTimer(4f, () => SwitchTo(pick), CounterStrikeSharp.API.Modules.Timers.TimerFlags.STOP_ON_MAPCHANGE);
            return;
        }

        // Vanlig bana och tom server: testa en otestad zm_-bana, eller gå till en som klarar bottar.
        if (humans > 0) { _emptyChecks = 0; return; }
        if (++_emptyChecks < 2) return;
        var next = PickOther(ZmUntested) ?? PickOther(ZmWithBots);
        if (next == null) return;
        Logger.LogInformation("Zombie: tom server – {What} {Map}", BotOk.ContainsKey(next.Value.name) ? "byter till" : "testar om bottar funkar på", next.Value.name);
        SwitchTo(next.Value);
    }

    private (string name, string id)? NextMap()
    {
        int min = Math.Max(1, Config.MinHumansForZm);
        if (HumanCount() < min)
        {
            var good = ZmWithBots;
            if (good.Count > 0)
            {
                int k = good.FindIndex(m => string.Equals(m.name, Server.MapName, StringComparison.OrdinalIgnoreCase));
                return good[k < 0 ? Random.Shared.Next(good.Count) : (k + 1) % good.Count];
            }
            var bm = BotMaps;
            if (bm.Count == 0) return null;
            int j = bm.FindIndex(m => string.Equals(m, Server.MapName, StringComparison.OrdinalIgnoreCase));
            return (bm[(j + 1) % bm.Count], "");
        }
        var maps = ZmMaps;
        if (maps.Count == 0) return null;
        var cur = Server.MapName;
        int i = maps.FindIndex(m => string.Equals(m.name, cur, StringComparison.OrdinalIgnoreCase));
        return maps[i < 0 ? Random.Shared.Next(maps.Count) : (i + 1) % maps.Count];
    }

    [ConsoleCommand("css_zmbots", "Show which zombie maps support bots")]
    public void OnZmBots(CCSPlayerController? player, CommandInfo cmd)
    {
        var lines = ZmMaps.Select(m => $"{m.name}: {(BotOk.TryGetValue(m.name, out var ok) ? (ok ? T("bottar OK", "bots OK") : T("inga bottar", "no bots")) : T("ej testad", "not tested"))}");
        foreach (var l in lines) { if (player == null) Console.WriteLine(l); else player.PrintToChat($" {P} {l}"); }
    }

    private bool ModeSwitchRequested()
    {
        try
        {
            var f = Path.GetFullPath(Path.Combine(ModuleDirectory, "..", "..", "data", "gs_panel", "requests", "mode.json"));
            return File.Exists(f) && DateTime.UtcNow - File.GetLastWriteTimeUtc(f) < TimeSpan.FromSeconds(60);
        }
        catch { return false; }
    }

    private void SwitchTo((string name, string id) map)
    {
        if (_switching) return;
        _switching = true;
        Server.ExecuteCommand(map.id != "" ? $"host_workshop_map {map.id}" : $"changelevel {map.name}");
    }

    [GameEventHandler]
    public HookResult OnMatchEndRotation(EventCsWinPanelMatch e, GameEventInfo info)
    {
        if (!Config.MapRotation) return HookResult.Continue;
        var next = NextMap();
        if (next == null) return HookResult.Continue;
        // Lägesomröstningen (!lage) körs först i ~20 s och kan starta om servern i ett annat läge.
        // Därför byter vi bana först efter den, och skjuter upp spelets egen kartbyte (som annars
        // tar en vanlig bana ur mapgroup) så att vår hinner före.
        AddTimer(1f, () => Server.ExecuteCommand("mp_match_restart_delay 45"), CounterStrikeSharp.API.Modules.Timers.TimerFlags.STOP_ON_MAPCHANGE);
        Server.PrintToChatAll($" {P} {T("Nästa bana", "Next map")}: {ChatColors.Green}{next.Value.name}");
        AddTimer(30f, () =>
        {
            if (ModeSwitchRequested()) return;
            var n = NextMap(); // räkna om – spelare kan ha kommit eller gått
            if (n != null) SwitchTo(n.Value);
        }, CounterStrikeSharp.API.Modules.Timers.TimerFlags.STOP_ON_MAPCHANGE);
        return HookResult.Continue;
    }

    [ConsoleCommand("css_nextmap", "Show the next map")]
    public void OnNextMap(CCSPlayerController? player, CommandInfo cmd)
    {
        var next = NextMap();
        var text = next == null ? T("Ingen bana inlagd.", "No maps configured.") : $"{T("Nästa bana", "Next map")}: {ChatColors.Green}{next.Value.name}";
        if (player == null) Console.WriteLine(text); else player.PrintToChat($" {P} {text}");
    }

    // ---------------------------------------------------------------- rundans MVP
    private const float RoundEndDelay = 10f;   // sekunder mellan rundslut och nästa runda
    private const float MvpShowSeconds = 8f;
    private readonly Dictionary<int, (int kills, int damage)> _round = new();
    private DateTime _mvpUntil = DateTime.MinValue;
    private string _mvpHtml = "";

    [GameEventHandler]
    public HookResult OnRoundStartMvp(EventRoundStart e, GameEventInfo info)
    {
        _round.Clear();
        _mvpUntil = DateTime.MinValue;
        _restartTimer?.Kill();
        _restartTimer = null;
        Server.ExecuteCommand($"mp_round_restart_delay {RoundEndDelay.ToString(CultureInfo.InvariantCulture)}");
        return HookResult.Continue;
    }

    [GameEventHandler]
    public HookResult OnHurtMvp(EventPlayerHurt e, GameEventInfo info)
    {
        var a = e.Attacker; var v = e.Userid;
        if (a == null || !a.IsValid || v == null || !v.IsValid || a == v) return HookResult.Continue;
        var cur = _round.GetValueOrDefault(a.Slot);
        _round[a.Slot] = (cur.kills, cur.damage + Math.Max(0, e.DmgHealth));
        return HookResult.Continue;
    }

    [GameEventHandler]
    public HookResult OnDeathMvp(EventPlayerDeath e, GameEventInfo info)
    {
        var a = e.Attacker; var v = e.Userid;
        if (a == null || !a.IsValid || v == null || !v.IsValid || a == v) return HookResult.Continue;
        var cur = _round.GetValueOrDefault(a.Slot);
        _round[a.Slot] = (cur.kills + 1, cur.damage);
        return HookResult.Continue;
    }

    // Ibland avslutar motorn rundan (round_end skickas) men startar aldrig nästa – då springer alla runt tills
    // rundtiden tar slut. Kommer ingen ny runda i tid ber vi spelreglerna avsluta rundan igen, vilket startar nästa.
    private CounterStrikeSharp.API.Modules.Timers.Timer? _restartTimer;
    private int _restartTries;

    private void ArmRestartWatchdog(int winner)
    {
        _restartTimer?.Kill();
        _restartTries = 0;
        var reason = winner switch { 3 => RoundEndReason.CTsWin, 2 => RoundEndReason.TerroristsWin, _ => RoundEndReason.RoundDraw };
        _restartTimer = AddTimer(RoundEndDelay + 2f, () =>
        {
            try
            {
                if (_restartTries++ >= 3) { _restartTimer?.Kill(); _restartTimer = null; return; }
                var rules = Utilities.FindAllEntitiesByDesignerName<CCSGameRulesProxy>("cs_gamerules").FirstOrDefault()?.GameRules;
                if (rules == null) return;
                Logger.LogInformation("Ingen ny runda efter rundslut – avslutar rundan igen ({Reason}, försök {Try})", reason, _restartTries);
                Server.ExecuteCommand("mp_ignore_round_win_conditions 0");
                rules.TerminateRound(1.0f, reason);
            }
            catch (Exception ex) { Logger.LogWarning("Omstart av runda misslyckades: {Msg}", ex.Message); }
        }, CounterStrikeSharp.API.Modules.Timers.TimerFlags.REPEAT | CounterStrikeSharp.API.Modules.Timers.TimerFlags.STOP_ON_MAPCHANGE);
    }

    [GameEventHandler(HookMode.Post)]
    public HookResult OnRoundEndMvp(EventRoundEnd e, GameEventInfo info)
    {
        ArmRestartWatchdog(e.Winner);
        // Topp 3: MVP stort överst, tvåan och trean (silver och brons) under.
        var top = _round
            .Select(kv => (p: Utilities.GetPlayerFromSlot(kv.Key), s: kv.Value))
            .Where(x => x.p != null && x.p.IsValid && !x.p.IsHLTV && (x.s.kills > 0 || x.s.damage > 0))
            .OrderByDescending(x => x.s.kills * 100 + x.s.damage)
            .Take(3)
            .ToList();
        if (top.Count == 0) return HookResult.Continue;
        var best = top[0];

        var p = best.p;
        try { p.MVPs++; Utilities.SetStateChanged(p, "CCSPlayerController", "m_iMVPs"); } catch { }
        var zombie = p.Team == CsTeam.Terrorist; // zombierna är T, människorna CT
        var role = zombie ? T("Zombie", "Zombie") : T("Människa", "Human");
        var stats = zombie
            ? T($"{best.s.kills} smittade · {best.s.damage} skada", $"{best.s.kills} infected · {best.s.damage} damage")
            : T($"{best.s.kills} kills · {best.s.damage} skada", $"{best.s.kills} kills · {best.s.damage} damage");
        var name = Esc(p.PlayerName);
        _mvpHtml =
            $"<font class='fontSize-xl' color='#FFD700'>★ {T("RUNDANS MVP", "ROUND MVP")}</font><br>" +
            $"<font class='fontSize-xl' color='{(zombie ? "#ff5a5a" : "#7CFC00")}'>{name}</font><br>" +
            $"<font class='fontSize-m' color='#ffffff'>{role} · {Esc(stats)}</font>";
        string[] medal = { "", "#C0C0C0", "#CD7F32" };
        for (int i = 1; i < top.Count; i++)
        {
            var (op, os) = top[i];
            var oz = op!.Team == CsTeam.Terrorist;
            var ostats = oz ? T($"{os.kills} smittade", $"{os.kills} infected") : $"{os.kills} kills";
            _mvpHtml += $"<br><font class='fontSize-m' color='{medal[i]}'>{i + 1}. {Esc(op.PlayerName)}</font>" +
                        $"<font class='fontSize-s' color='#cccccc'> – {Esc(ostats)} · {os.damage} {T("skada", "dmg")}</font>";
        }
        _mvpUntil = DateTime.UtcNow.AddSeconds(MvpShowSeconds);
        Server.PrintToChatAll($" {P} {ChatColors.Gold}★ {T("Rundans MVP", "Round MVP")}:{ChatColors.Default} {(zombie ? ChatColors.Red : ChatColors.Green)}{p.PlayerName}{ChatColors.Default} – {stats}");
        return HookResult.Continue;
    }

    private void ShowMvp()
    {
        if (DateTime.UtcNow >= _mvpUntil) return;
        foreach (var h in Utilities.GetPlayers())
            if (h != null && h.IsValid && !h.IsBot && !_menus.ContainsKey(h.Slot)) h.PrintToCenterHtml(_mvpHtml);
    }

    private void NoWarmup()
    {
        try
        {
            var rules = Utilities.FindAllEntitiesByDesignerName<CCSGameRulesProxy>("cs_gamerules").FirstOrDefault()?.GameRules;
            if (rules == null || !rules.WarmupPeriod) return;
            Server.ExecuteCommand("mp_do_warmup_period 0");
            Server.ExecuteCommand("mp_warmuptime 0");
            Server.ExecuteCommand("mp_warmup_end");
        }
        catch { /* kartan laddas */ }
    }

    private static bool IsAdmin(CCSPlayerController p) =>
        AdminManager.PlayerHasPermissions(p, "@css/root") || AdminManager.PlayerHasPermissions(p, "@css/config")
        || AdminManager.PlayerHasPermissions(p, "@css/generic");

    [ConsoleCommand("css_zm", "Zombie settings (admin)")]
    [ConsoleCommand("css_zombie", "Zombie settings (admin)")]
    [CommandHelper(whoCanExecute: CommandUsage.CLIENT_ONLY)]
    public void OnZm(CCSPlayerController? player, CommandInfo cmd)
    {
        if (player == null || !player.IsValid || player.IsBot) return;
        if (!IsAdmin(player)) { player.PrintToChat($" {P} {T("Bara admins kan ändra zombie-inställningarna.", "Only admins can change the zombie settings.")}"); return; }
        JsonNode? json;
        try { json = JsonNode.Parse(File.ReadAllText(ZombieFile), documentOptions: new JsonDocumentOptions { CommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true }); }
        catch (Exception ex)
        {
            Logger.LogWarning("Kunde inte läsa {File}: {Msg}", ZombieFile, ex.Message);
            player.PrintToChat($" {P} {T("Hittar inte zombie-configen.", "Cannot find the zombie config.")}");
            return;
        }
        var values = Fields.Select(f => Get(json, f.Path) ?? f.Def).ToArray();
        _menus[player.Slot] = new MenuState { Json = json, Values = values, Last = player.Buttons };
    }

    private static double? Get(JsonNode? root, string path)
    {
        JsonNode? n = root;
        foreach (var k in path.Split('.')) { n = n?[k]; if (n == null) return null; }
        try { return n!.GetValue<double>(); } catch { return null; }
    }

    private static void Set(JsonNode root, string path, double v, bool integer)
    {
        var keys = path.Split('.');
        JsonNode n = root;
        foreach (var k in keys[..^1]) n = n[k] ??= new JsonObject();
        n[keys[^1]] = integer ? JsonValue.Create((int)Math.Round(v)) : JsonValue.Create(Math.Round(v, 2));
    }

    private int ItemCount => Fields.Length + 3; // + spara & starta om, spara, stäng

    private void OnTick()
    {
        ShowMvp();
        if (_menus.Count == 0) return;
        foreach (var slot in _menus.Keys.ToList())
        {
            if (!_menus.TryGetValue(slot, out var m)) continue;
            var p = Utilities.GetPlayerFromSlot(slot);
            if (p == null || !p.IsValid || p.IsBot || (DateTime.UtcNow - m.Opened).TotalSeconds > 120) { _menus.Remove(slot); continue; }

            var now = p.Buttons;
            var pressed = now & ~m.Last;
            m.Last = now;

            if ((pressed & PlayerButtons.Forward) != 0) m.Sel = (m.Sel - 1 + ItemCount) % ItemCount;
            else if ((pressed & PlayerButtons.Back) != 0) m.Sel = (m.Sel + 1) % ItemCount;
            else if ((pressed & (PlayerButtons.Moveleft | PlayerButtons.Moveright)) != 0 && m.Sel < Fields.Length)
            {
                var f = Fields[m.Sel];
                var dir = (pressed & PlayerButtons.Moveright) != 0 ? 1 : -1;
                m.Values[m.Sel] = Math.Clamp(Math.Round((m.Values[m.Sel] + dir * f.Step) / f.Step) * f.Step, f.Min, f.Max);
                m.Dirty = true;
            }
            else if ((pressed & PlayerButtons.Use) != 0 && m.Sel >= Fields.Length)
            {
                var action = m.Sel - Fields.Length;
                if (action == 2) { Close(p); continue; }
                if (Save(p, m)) { Close(p); if (action == 0) RequestRestart(p); }
                continue;
            }
            else if ((pressed & PlayerButtons.Reload) != 0) { Close(p); continue; }

            Render(p, m);
        }
    }

    private void Close(CCSPlayerController p) { if (_menus.Remove(p.Slot)) p.PrintToCenterHtml(" "); }

    private bool Save(CCSPlayerController p, MenuState m)
    {
        try
        {
            for (int i = 0; i < Fields.Length; i++)
                Set(m.Json!, Fields[i].Path, m.Values[i], Fields[i].Step % 1 == 0);
            var minutes = ((int)Math.Ceiling(m.Values[0] / 60)).ToString(CultureInfo.InvariantCulture);
            var cvars = m.Json!["cvars"] as JsonObject ?? new JsonObject();
            cvars["mp_roundtime"] = minutes; cvars["mp_roundtime_defuse"] = minutes; cvars["mp_roundtime_hostage"] = minutes;
            m.Json!["cvars"] = cvars;
            File.Copy(ZombieFile, ZombieFile + ".zm-backup", true);
            File.WriteAllText(ZombieFile, m.Json!.ToJsonString(new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));
            p.PrintToChat($" {P} {T("Zombie-inställningarna är sparade.", "Zombie settings saved.")}");
            Logger.LogInformation("{Name} sparade zombie-inställningar", p.PlayerName);
            return true;
        }
        catch (Exception ex)
        {
            Logger.LogError("Kunde inte spara: {Msg}", ex.Message);
            p.PrintToChat($" {P} {ChatColors.Red}{T("Kunde inte spara inställningarna.", "Could not save the settings.")}");
            return false;
        }
    }

    // Panelen läser data/gs_panel/requests/mode.json och startar om servern i samma läge.
    private void RequestRestart(CCSPlayerController p)
    {
        try
        {
            var dir = Path.GetFullPath(Path.Combine(ModuleDirectory, "..", "..", "data", "gs_panel", "requests"));
            Directory.CreateDirectory(dir);
            var file = Path.Combine(dir, "mode.json");
            File.WriteAllText(file + ".tmp", JsonSerializer.Serialize(new { mode = "zombie", restart = true, t = DateTime.UtcNow, by = p.PlayerName }));
            File.Move(file + ".tmp", file, true);
            Server.PrintToChatAll($" {P} {ChatColors.Red}{T("Servern startar om med nya zombie-inställningar – återanslut om ca 30 sekunder.", "The server is restarting with new zombie settings – reconnect in about 30 seconds.")}");
        }
        catch (Exception ex)
        {
            Logger.LogError("Kunde inte begära omstart: {Msg}", ex.Message);
            p.PrintToChat($" {P} {T("Sparat, men omstarten misslyckades – starta om från panelen.", "Saved, but the restart failed – restart from the panel.")}");
        }
    }

    private static string Esc(string s) => s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;");

    private void Render(CCSPlayerController p, MenuState m)
    {
        var sb = new System.Text.StringBuilder();
        sb.Append($"<font color='#f5a524' class='fontSize-m'>{T("Zombie-inställningar", "Zombie settings")}</font><br>");
        sb.Append($"<font color='#9b917f' class='fontSize-s'>{T("W/S välj · A/D ändra · E spara · R stäng", "W/S select · A/D change · E save · R close")}</font><br>");
        // Visa bara några rader åt gången – mitten-texten i CS2 får inte plats med alla.
        const int window = 6;
        int start = Math.Clamp(m.Sel - window / 2, 0, Math.Max(0, ItemCount - window));
        if (start > 0) sb.Append("<font color='#9b917f'>▲</font><br>");
        for (int i = start; i < Math.Min(ItemCount, start + window); i++)
        {
            string text;
            if (i < Fields.Length)
            {
                var f = Fields[i];
                var v = m.Values[i].ToString(f.Step % 1 == 0 ? "0" : "0.##", CultureInfo.InvariantCulture);
                text = $"{(Sv ? f.Sv : f.En)}: ◀ {v} ▶";
            }
            else text = (i - Fields.Length) switch
            {
                0 => T("Spara och starta om", "Save and restart"),
                1 => T("Spara (gäller vid nästa start)", "Save (applies next start)"),
                _ => T("Stäng", "Close"),
            };
            sb.Append(i == m.Sel ? $"<font color='#7CFC00'>▶ {Esc(text)}</font><br>" : $"<font color='#ffffff'>{Esc(text)}</font><br>");
        }
        if (start + window < ItemCount) sb.Append("<font color='#9b917f'>▼</font>");
        p.PrintToCenterHtml(sb.ToString());
    }
}
