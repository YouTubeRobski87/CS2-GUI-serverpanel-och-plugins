using System.Text.Json.Serialization;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Cvars;
using CounterStrikeSharp.API.Modules.Memory;
using CounterStrikeSharp.API.Modules.Utils;
using CounterStrikeSharp.API.Modules.Timers;
using Microsoft.Extensions.Logging;

namespace GamlaSkolanMvp;

public class MvpConfig : BasePluginConfig
{
    [JsonPropertyName("KillLimit")] public int KillLimit { get; set; } = 100;
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
    public override string ModuleVersion => "1.2.0";
    public override string ModuleAuthor => "Gamla Skolan";
    public override string ModuleDescription => "First to X kills in deathmatch is MVP, then the map changes.";

    public MvpConfig Config { get; set; } = new();
    private bool Sv => string.Equals(Config.Language, "sv", StringComparison.OrdinalIgnoreCase);
    private string T(string sv, string en) => Sv ? sv : en;
    private string P => Config.Prefix
        .Replace("{gold}", $"{ChatColors.Gold}").Replace("{default}", $"{ChatColors.Default}")
        .Replace("{green}", $"{ChatColors.Green}").Replace("{red}", $"{ChatColors.Red}")
        .Replace("{lightred}", $"{ChatColors.LightRed}").Replace("{blue}", $"{ChatColors.Blue}");

    private readonly Dictionary<ulong, int> _kills = new();
    private bool _finished;

    public void OnConfigParsed(MvpConfig config)
    {
        config.KillLimit = Math.Clamp(config.KillLimit, 5, 1000);
        config.CelebrationSeconds = Math.Clamp(config.CelebrationSeconds, 3, 30);
        Config = config;
    }

    public override void Load(bool hotReload)
    {
        RegisterListener<Listeners.OnMapStart>(_ => { _kills.Clear(); _finished = false; });
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
        string Chat(int secs) => T($" \x10★ MVP ★\x01 \x04{name}\x01 var först till \x04{Config.KillLimit} kills\x01! {nextText} om {secs} sekunder.",
                                   $" \x10★ MVP ★\x01 \x04{name}\x01 was first to \x04{Config.KillLimit} kills\x01! {nextText} in {secs} seconds.");
        string chat = Chat(Config.CelebrationSeconds);
        Server.PrintToChatAll(chat);

        // Frys alla och gör dem odödliga under firandet, så att ingen spelar vidare.
        FreezeAll();

        DateTime end = DateTime.UtcNow.AddSeconds(Config.CelebrationSeconds);
        int lastChatSecond = Config.CelebrationSeconds;
        AddTimer(0.25f, () =>
        {
            int left = Math.Max(0, (int)Math.Ceiling((end - DateTime.UtcNow).TotalSeconds));
            FreezeAll(); // fångar även spelare som respawnar under firandet
            string html =
                "<font class='fontSize-xl' color='#FFD700'>★ MVP ★</font><br>" +
                $"<font class='fontSize-l' color='#FFFFFF'>{System.Net.WebUtility.HtmlEncode(name)}</font><br>" +
                $"<font class='fontSize-m' color='#A0FFA0'>{T("Först till", "First to")} {Config.KillLimit} kills!</font><br>" +
                $"<font class='fontSize-s' color='#CCCCCC'>{System.Net.WebUtility.HtmlEncode(nextText)} {T("om", "in")} {left} s</font>";
            foreach (var p in Utilities.GetPlayers().Where(IsHuman))
                p.PrintToCenterHtml(html, 1);
            if (left > 0 && left % 4 == 0 && left != lastChatSecond)
            {
                lastChatSecond = left;
                Server.PrintToChatAll(Chat(left));
            }
        }, TimerFlags.REPEAT | TimerFlags.STOP_ON_MAPCHANGE);

        AddTimer(Config.CelebrationSeconds + 0.5f, () =>
        {
            Logger.LogInformation("MVP {Name} nadde {Limit} kills pa {Map}, byter till {Next}", name, Config.KillLimit, current, next ?? "(samma karta)");
            Server.ExecuteCommand($"changelevel {next ?? current}");
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

    private string? NextMap(string current)
    {
        try
        {
            string[] candidates =
            {
                Path.Combine(Server.GameDirectory, "csgo", Config.MapCycleFile),
                Path.Combine(Server.GameDirectory, Config.MapCycleFile),
            };
            var file = candidates.FirstOrDefault(File.Exists);
            if (file == null) return null;
            var maps = File.ReadAllLines(file).Select(l => l.Trim())
                .Where(l => l.Length > 0 && !l.StartsWith("//")).ToList();
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
