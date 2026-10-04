using System.Text.Json;
using System.Text.Json.Serialization;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Commands;
using CounterStrikeSharp.API.Modules.Cvars;
using Microsoft.Extensions.Logging;

namespace GamlaSkolanRank;

public class RankConfig : BasePluginConfig
{
    [JsonPropertyName("PointsPerKill")] public int PointsPerKill { get; set; } = 10;
    [JsonPropertyName("PointsLostPerDeath")] public int PointsLostPerDeath { get; set; } = 5;
    [JsonPropertyName("MinimumHumanPlayers")] public int MinimumHumanPlayers { get; set; } = 2;
    [JsonPropertyName("TopCount")] public int TopCount { get; set; } = 10;
    [JsonPropertyName("ShowPointMessages")] public bool ShowPointMessages { get; set; } = true;
}

public class PlayerRank
{
    public ulong SteamId { get; set; }
    public string Name { get; set; } = "Okand";
    public int Points { get; set; }
    public int Kills { get; set; }
    public int Deaths { get; set; }
    public DateTime LastSeenUtc { get; set; }
}

[MinimumApiVersion(375)]
public class GamlaSkolanRankPlugin : BasePlugin, IPluginConfig<RankConfig>
{
    public override string ModuleName => "Gamla Skolan Rank";
    public override string ModuleVersion => "1.1.0";
    public override string ModuleAuthor => "Gamla Skolan";
    public override string ModuleDescription => "Smal persistent rank for K4-Arenas och Deathmatch.";

    private readonly object _sync = new();
    private Dictionary<ulong, PlayerRank> _players = new();
    private string _dataFile = string.Empty;

    public RankConfig Config { get; set; } = new();

    public void OnConfigParsed(RankConfig config)
    {
        config.PointsPerKill = Math.Clamp(config.PointsPerKill, 0, 1000);
        config.PointsLostPerDeath = Math.Clamp(config.PointsLostPerDeath, 0, 1000);
        config.MinimumHumanPlayers = Math.Clamp(config.MinimumHumanPlayers, 1, 64);
        config.TopCount = Math.Clamp(config.TopCount, 3, 15);
        Config = config;
    }

    public override void Load(bool hotReload)
    {
        _dataFile = Path.Combine(ModuleDirectory, "data", "rankings.json");
        LoadRankings();
    }

    [GameEventHandler(HookMode.Post)]
    public HookResult OnPlayerDeath(EventPlayerDeath @event, GameEventInfo info)
    {
        var attacker = @event.Attacker;
        var victim = @event.Userid;

        // Båda måste vara riktiga spelarslots (inte HLTV), och minst en måste vara människa.
        if (!IsPlayer(attacker) || !IsPlayer(victim) || attacker == victim)
            return HookResult.Continue;
        bool attackerHuman = !attacker!.IsBot;
        bool victimHuman = !victim!.IsBot;
        if (!attackerHuman && !victimHuman)
            return HookResult.Continue;

        // Lagkontroll bara när lagkamrater inte är fiender (t.ex. K4-Arenas). I deathmatch (FFA) räknas alla kills.
        if (!TeammatesAreEnemies() && attacker.Team == victim.Team)
            return HookResult.Continue;

        if (Utilities.GetPlayers().Count(IsHuman) < Config.MinimumHumanPlayers)
            return HookResult.Continue;

        // Bottinblandning ger halva poäng åt båda hållen.
        bool botInvolved = !attackerHuman || !victimHuman;
        int gain = botInvolved ? Config.PointsPerKill / 2 : Config.PointsPerKill;
        int loss = botInvolved ? Config.PointsLostPerDeath / 2 : Config.PointsLostPerDeath;

        lock (_sync)
        {
            PlayerRank? killer = null, dead = null;
            if (attackerHuman)
            {
                killer = GetOrCreate(attacker);
                killer.Kills++;
                killer.Points += gain;
                killer.LastSeenUtc = DateTime.UtcNow;
            }
            if (victimHuman)
            {
                dead = GetOrCreate(victim);
                dead.Deaths++;
                dead.Points = Math.Max(0, dead.Points - loss);
                dead.LastSeenUtc = DateTime.UtcNow;
            }

            SaveRankings();

            if (Config.ShowPointMessages)
            {
                if (killer != null)
                {
                    attacker.PrintToChat($" \x04[Rank]\x01 +{gain} poang • {Tier(killer.Points)} • {killer.Points}p");
                    attacker.PrintToCenter($"+{gain} RANK");
                }
                if (dead != null)
                {
                    victim.PrintToChat($" \x02[Rank]\x01 -{loss} poang • {Tier(dead.Points)} • {dead.Points}p");
                    victim.PrintToCenter($"-{loss} RANK");
                }
            }
        }
        return HookResult.Continue;
    }

    [ConsoleCommand("css_rank", "Visa din rank")]
    [CommandHelper(whoCanExecute: CommandUsage.CLIENT_ONLY)]
    public void OnRankCommand(CCSPlayerController? player, CommandInfo command)
    {
        if (!IsHuman(player)) return;
        lock (_sync)
        {
            var current = GetOrCreate(player!);
            SaveRankings();
            var ordered = OrderedPlayers();
            int position = ordered.FindIndex(p => p.SteamId == current.SteamId) + 1;
            player!.PrintToChat($" \x04[Rank]\x01 #{position}/{ordered.Count} • {Tier(current.Points)} • {current.Points}p • K/D {current.Kills}/{current.Deaths}");
        }
    }

    [ConsoleCommand("css_top", "Visa topplistan")]
    [CommandHelper(whoCanExecute: CommandUsage.CLIENT_ONLY)]
    public void OnTopCommand(CCSPlayerController? player, CommandInfo command)
    {
        if (!IsHuman(player)) return;
        lock (_sync)
        {
            var top = OrderedPlayers().Take(Config.TopCount).ToList();
            player!.PrintToChat(" \x04[Rank]\x01 Topplista");
            if (top.Count == 0)
            {
                player.PrintToChat(" \x01Ingen har fatt rankpoang annu.");
                return;
            }
            for (int i = 0; i < top.Count; i++)
            {
                var r = top[i];
                player.PrintToChat($" \x01{i + 1}. \x04{r.Name}\x01 • {Tier(r.Points)} • {r.Points}p");
            }
        }
    }

    private static bool IsPlayer(CCSPlayerController? p) => p != null && p.IsValid && !p.IsHLTV;

    private static bool IsHuman(CCSPlayerController? p) => p != null && p.IsValid && !p.IsBot && !p.IsHLTV;

    private static bool TeammatesAreEnemies()
    {
        try { return ConVar.Find("mp_teammates_are_enemies")?.GetPrimitiveValue<bool>() ?? false; }
        catch { return false; }
    }

    private PlayerRank GetOrCreate(CCSPlayerController player)
    {
        ulong steamId = player.AuthorizedSteamID?.SteamId64 ?? player.SteamID;
        if (!_players.TryGetValue(steamId, out var rank))
        {
            rank = new PlayerRank { SteamId = steamId };
            _players[steamId] = rank;
        }
        rank.Name = string.IsNullOrWhiteSpace(player.PlayerName) ? rank.Name : player.PlayerName;
        rank.LastSeenUtc = DateTime.UtcNow;
        return rank;
    }

    private List<PlayerRank> OrderedPlayers() => _players.Values
        .OrderByDescending(p => p.Points)
        .ThenByDescending(p => p.Kills)
        .ThenBy(p => p.Deaths)
        .ThenBy(p => p.Name, StringComparer.OrdinalIgnoreCase)
        .ToList();

    private static string Tier(int points) => points switch
    {
        >= 3000 => "Global Elite",
        >= 2000 => "Supreme Master",
        >= 1400 => "Legendary Eagle",
        >= 900 => "Distinguished Master",
        >= 500 => "Master Guardian",
        >= 250 => "Gold Nova",
        >= 100 => "Silver Elite",
        _ => "Silver I",
    };

    private void LoadRankings()
    {
        lock (_sync)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(_dataFile)!);
                if (!File.Exists(_dataFile)) return;
                var list = JsonSerializer.Deserialize<List<PlayerRank>>(File.ReadAllText(_dataFile));
                _players = list?.Where(p => p.SteamId > 0).ToDictionary(p => p.SteamId) ?? new();
            }
            catch (Exception ex)
            {
                Logger.LogError(ex, "Kunde inte lasa rankdata. En tom ranklista anvands utan att skriva over originalfilen.");
                _players = new();
            }
        }
    }

    private void SaveRankings()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_dataFile)!);
        string tmp = _dataFile + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(OrderedPlayers(), new JsonSerializerOptions { WriteIndented = true }));
        File.Move(tmp, _dataFile, true);
    }
}
