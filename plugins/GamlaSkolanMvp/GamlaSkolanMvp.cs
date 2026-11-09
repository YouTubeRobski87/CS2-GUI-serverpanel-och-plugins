using System.Text.Json.Serialization;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Cvars;
using CounterStrikeSharp.API.Modules.Memory;
using CounterStrikeSharp.API.Modules.Utils;
using CounterStrikeSharp.API.Modules.Entities.Constants;
using CounterStrikeSharp.API.Modules.Timers;
using Microsoft.Extensions.Logging;

namespace GamlaSkolanMvp;

public class MvpConfig : BasePluginConfig
{
    [JsonPropertyName("KillLimit")] public int KillLimit { get; set; } = 50;
    [JsonPropertyName("CelebrationSeconds")] public int CelebrationSeconds { get; set; } = 10;
    [JsonPropertyName("MapCycleFile")] public string MapCycleFile { get; set; } = "mapcycle_dm.txt";
    [JsonPropertyName("Prefix")] public string Prefix { get; set; } = "{green}[Server]{default}";
    // "en" eller "sv"
    [JsonPropertyName("Language")] public string Language { get; set; } = "en";
}

[MinimumApiVersion(375)]
public class GamlaSkolanMvpPlugin : BasePlugin, IPluginConfig<MvpConfig>
{
    public override string ModuleName => "Gamla Skolan MVP";
    public override string ModuleVersion => "1.4.0";
    public override string ModuleAuthor => "Gamla Skolan";
    public override string ModuleDescription => "First to X kills in deathmatch is MVP, then the match ends with the normal results screen.";

    public MvpConfig Config { get; set; } = new();
    private bool Sv => string.Equals(Config.Language, "sv", StringComparison.OrdinalIgnoreCase);
    private string T(string sv, string en) => Sv ? sv : en;
    private string P => Config.Prefix
        .Replace("{gold}", $"{ChatColors.Gold}").Replace("{default}", $"{ChatColors.Default}")
        .Replace("{green}", $"{ChatColors.Green}").Replace("{red}", $"{ChatColors.Red}")
        .Replace("{lightred}", $"{ChatColors.LightRed}").Replace("{blue}", $"{ChatColors.Blue}");

    private readonly Dictionary<ulong, int> _kills = new();
    private bool _finished;
    private bool _matchEndShown;

    public void OnConfigParsed(MvpConfig config)
    {
        config.KillLimit = Math.Clamp(config.KillLimit, 5, 1000);
        config.CelebrationSeconds = Math.Clamp(config.CelebrationSeconds, 3, 30);
        Config = config;
    }

    public override void Load(bool hotReload)
    {
        RegisterListener<Listeners.OnMapStart>(_ =>
        {
            _kills.Clear();
            _finished = false;
            _matchEndShown = false;
            // Matchslutet sätter mp_maxrounds 1 – återställ lägets inställningar på nya kartan
            AddTimer(1.0f, () => { if (IsDeathmatch()) Server.ExecuteCommand("exec gamla_dm_classic.cfg"); }, TimerFlags.STOP_ON_MAPCHANGE);
        });
    }

    [GameEventHandler]
    public HookResult OnMatchEnd(EventCsWinPanelMatch e, GameEventInfo info)
    {
        _matchEndShown = true;
        return HookResult.Continue;
    }

    private static bool IsDeathmatch()
    {
        try
        {
            return ConVar.Find("game_type")?.GetPrimitiveValue<int>() == 1
                && ConVar.Find("game_mode")?.GetPrimitiveValue<int>() == 2;
        }
        catch { return false; }
    }

    private static bool IsHuman(CCSPlayerController? p) => p != null && p.IsValid && !p.IsBot && !p.IsHLTV;

    [GameEventHandler(HookMode.Post)]
    public HookResult OnPlayerDeath(EventPlayerDeath @event, GameEventInfo info)
    {
        if (_finished || !IsDeathmatch()) return HookResult.Continue;

        var attacker = @event.Attacker;
        var victim = @event.Userid;
        if (!IsHuman(attacker) || attacker == victim) return HookResult.Continue;

        ulong id = attacker!.AuthorizedSteamID?.SteamId64 ?? attacker.SteamID;
        int kills = _kills.TryGetValue(id, out var k) ? k + 1 : 1;
        _kills[id] = kills;

        if (kills == Config.KillLimit - 10 || kills == Config.KillLimit - 5)
            Server.PrintToChatAll(T($" {P} {attacker.PlayerName} har \x04{kills}\x01 kills – {Config.KillLimit - kills} kvar till vinst!",
                                    $" {P} {attacker.PlayerName} has \x04{kills}\x01 kills – {Config.KillLimit - kills} to go!"));

        if (kills >= Config.KillLimit)
            Finish(attacker);

        return HookResult.Continue;
    }

    private void Finish(CCSPlayerController winner)
    {
        _finished = true;
        string name = winner.PlayerName;
        string current = Server.MapName;
        string? next = NextMap(current);

        // MVP-stjarna pa scoreboarden.
        try
        {
            winner.MVPs++;
            Utilities.SetStateChanged(winner, "CCSPlayerController", "m_iMVPs");
        }
        catch (Exception ex) { Logger.LogWarning(ex, "Kunde inte satta MVP-stjarna"); }

        string nextText = next != null ? T($"Nästa karta: {next}", $"Next map: {next}") : T("Ny karta laddas", "New map loading");
        Server.PrintToChatAll(T($" \x10★ MVP ★\x01 \x04{name}\x01 var först till \x04{Config.KillLimit} kills\x01! {nextText} efter matchen.",
                                $" \x10★ MVP ★\x01 \x04{name}\x01 was first to \x04{Config.KillLimit} kills\x01! {nextText} after the match."));
        Logger.LogInformation("MVP {Name} nadde {Limit} kills pa {Map}, avslutar matchen (nasta: {Next})", name, Config.KillLimit, current, next ?? "(samma karta)");

        // Avsluta matchen på riktigt: CS2 visar då matchresultatet med SEGER och spelarkorten,
        // och GamlaSkolanLage startar omröstningen om spelläge. Vanliga banor väljs via nextlevel.
        if (next != null && !next.All(char.IsDigit)) Server.ExecuteCommand($"nextlevel {next}");
        Server.ExecuteCommand("mp_match_end_changelevel 1");
        Server.ExecuteCommand("mp_endmatch_votenextmap 0");
        Server.ExecuteCommand("mp_ignore_round_win_conditions 0");
        Server.ExecuteCommand("mp_maxrounds 1");
        FreezeAll(); // ingen spelar vidare under de sekunder det tar innan matchresultatet visas
        var reason = winner.Team == CsTeam.CounterTerrorist ? RoundEndReason.CTsWin : RoundEndReason.TerroristsWin;
        try
        {
            var rules = Utilities.FindAllEntitiesByDesignerName<CCSGameRulesProxy>("cs_gamerules").FirstOrDefault()?.GameRules;
            rules?.TerminateRound(3.0f, reason);
        }
        catch (Exception ex) { Logger.LogWarning(ex, "Kunde inte avsluta rundan"); }

        // Reserv: om matchresultatet inte visas inom 12 s byts kartan som förut.
        AddTimer(12f, () =>
        {
            if (_matchEndShown) return;
            Logger.LogWarning("Matchresultatet visades inte - byter karta direkt");
            Server.ExecuteCommand(MapCommand(next ?? current));
        }, TimerFlags.STOP_ON_MAPCHANGE);
    }

    private void FreezeAll()
    {
        foreach (var p in Utilities.GetPlayers())
        {
            try
            {
                if (p == null || !p.IsValid || !p.PawnIsAlive) continue;
                var pawn = p.PlayerPawn.Value;
                if (pawn == null || !pawn.IsValid) continue;
                pawn.TakesDamage = false;
                if (pawn.MoveType != MoveType_t.MOVETYPE_OBSOLETE)
                {
                    pawn.MoveType = MoveType_t.MOVETYPE_OBSOLETE;
                    Schema.SetSchemaValue(pawn.Handle, "CBaseEntity", "m_nActualMoveType", 1);
                    Utilities.SetStateChanged(pawn, "CBaseEntity", "m_MoveType");
                }
            }
            catch { }
        }
    }

    // Lägets kartlista från panelen (data/gs_panel/current_mode.json, fältet "maps").
    private List<string> PanelMaps()
    {
        try
        {
            var file = Path.GetFullPath(Path.Combine(ModuleDirectory, "..", "..", "data", "gs_panel", "current_mode.json"));
            if (!File.Exists(file)) return new();
            using var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(file).TrimStart('\uFEFF'));
            if (!doc.RootElement.TryGetProperty("maps", out var arr) || arr.ValueKind != System.Text.Json.JsonValueKind.Array) return new();
            return arr.EnumerateArray().Where(e => e.ValueKind == System.Text.Json.JsonValueKind.String)
                .Select(e => (e.GetString() ?? "").Trim()).Where(m => m.Length > 0).ToList();
        }
        catch (Exception ex)
        {
            Logger.LogWarning(ex, "Kunde inte lasa panelens kartlista");
            return new();
        }
    }

    // Workshopbanor (bara siffror) laddas med host_workshop_map, vanliga banor med changelevel.
    private static string MapCommand(string map) =>
        map.All(char.IsDigit) ? $"host_workshop_map {map}" : $"changelevel {map}";

    private string? NextMap(string current)
    {
        try
        {
            // 1) Panelens kartlista för läget  2) reserv: mapcycle-filen
            var maps = PanelMaps();
            if (maps.Count == 0)
            {
                string[] candidates =
                {
                    Path.Combine(Server.GameDirectory, "csgo", Config.MapCycleFile),
                    Path.Combine(Server.GameDirectory, Config.MapCycleFile),
                };
                var file = candidates.FirstOrDefault(File.Exists);
                if (file == null) return null;
                maps = File.ReadAllLines(file).Select(l => l.Trim())
                    .Where(l => l.Length > 0 && !l.StartsWith("//")).ToList();
            }
            if (maps.Count == 0) return null;
            int i = maps.FindIndex(m => m.Equals(current, StringComparison.OrdinalIgnoreCase));
            return i >= 0 ? maps[(i + 1) % maps.Count] : maps[0];
        }
        catch (Exception ex)
        {
            Logger.LogWarning(ex, "Kunde inte lasa mapcycle");
            return null;
        }
    }
}
