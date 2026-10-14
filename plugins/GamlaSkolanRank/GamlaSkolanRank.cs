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
    // "en" eller "sv"
    [JsonPropertyName("Language")] public string Language { get; set; } = "en";
    // Statistiksidan: adress till ingest-funktionen och den hemliga token. Tomt = av.
    [JsonPropertyName("StatsUrl")] public string StatsUrl { get; set; } = "";
    [JsonPropertyName("StatsToken")] public string StatsToken { get; set; } = "";
}

public record PlayerDto(string steam_id, string name, int points, int kills, int deaths, DateTime last_seen);

public class PlayerRank
{
    public ulong SteamId { get; set; }
    public string Name { get; set; } = "Unknown";
    public int Points { get; set; }
    public int Kills { get; set; }
    public int Deaths { get; set; }
    public DateTime LastSeenUtc { get; set; }
}

[MinimumApiVersion(375)]
public class GamlaSkolanRankPlugin : BasePlugin, IPluginConfig<RankConfig>
{
    public override string ModuleName => "Gamla Skolan Rank";
    public override string ModuleVersion => "1.3.0";
    public override string ModuleAuthor => "Gamla Skolan";
    public override string ModuleDescription => "Simple persistent rank for K4-Arenas and Deathmatch.";

    private readonly object _sync = new();
    private Dictionary<ulong, PlayerRank> _players = new();
    private string _dataFile = string.Empty;

    public RankConfig Config { get; set; } = new();
    private bool Sv => string.Equals(Config.Language, "sv", StringComparison.OrdinalIgnoreCase);
    private string T(string sv, string en) => Sv ? sv : en;

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
        AddTimer(15f, FlushStats, CounterStrikeSharp.API.Modules.Timers.TimerFlags.REPEAT);
    }

    public override void Unload(bool hotReload) => FlushStats();

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

        bool ranked = Utilities.GetPlayers().Count(IsHuman) >= Config.MinimumHumanPlayers;
        QueueKill(attacker, victim, @event.Weapon, @event.Headshot, ranked);
        if (!ranked)
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
            if (killer != null) _dirty.Add(killer.SteamId);
            if (dead != null) _dirty.Add(dead.SteamId);

            if (Config.ShowPointMessages)
            {
                if (killer != null)
                {
                    attacker.PrintToChat($" \x04[Rank]\x01 +{gain} {T("poäng", "points")} • {Tier(killer.Points)} • {killer.Points}p");
                    attacker.PrintToCenter($"+{gain} RANK");
                }
                if (dead != null)
                {
                    victim.PrintToChat($" \x02[Rank]\x01 -{loss} {T("poäng", "points")} • {Tier(dead.Points)} • {dead.Points}p");
                    victim.PrintToCenter($"-{loss} RANK");
                }
            }
        }
        return HookResult.Continue;
    }

    [ConsoleCommand("css_rank", "Show your rank")]
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

    [ConsoleCommand("css_top", "Show the leaderboard")]
    [CommandHelper(whoCanExecute: CommandUsage.CLIENT_ONLY)]
    public void OnTopCommand(CCSPlayerController? player, CommandInfo command)
    {
        if (!IsHuman(player)) return;
        lock (_sync)
        {
            var top = OrderedPlayers().Take(Config.TopCount).ToList();
            player!.PrintToChat($" \x04[Rank]\x01 {T("Topplista", "Leaderboard")}");
            if (top.Count == 0)
            {
                player.PrintToChat($" \x01{T("Ingen har fått rankpoäng ännu.", "Nobody has earned rank points yet.")}");
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

    // ---------------------------------------------------------------- statistiksidan
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(10) };
    private readonly List<object> _pendingKills = new();
    private readonly HashSet<ulong> _dirty = new();
    private int _sending;

    private static readonly (string id, string dir)[] Modes =
    {
        ("retakes", "RetakesPlugin"), ("deathmatch", "Deathmatch"), ("arenas", "K4-Arenas"), ("zombie", "ZombieMode"),
    };

    private string CurrentMode()
    {
        var pluginsDir = Path.GetFullPath(Path.Combine(ModuleDirectory, ".."));
        foreach (var m in Modes)
            if (Directory.Exists(Path.Combine(pluginsDir, m.dir))) return m.id;
        return "other";
    }

    private static ulong SteamIdOf(CCSPlayerController p) => p.IsBot ? 0 : (p.AuthorizedSteamID?.SteamId64 ?? p.SteamID);

    private void QueueKill(CCSPlayerController attacker, CCSPlayerController victim, string weapon, bool headshot, bool ranked)
    {
        if (string.IsNullOrWhiteSpace(Config.StatsUrl)) return;
        string map = "", mode = "";
        try { map = Server.MapName; mode = CurrentMode(); } catch { }
        var kill = new
        {
            at = DateTime.UtcNow,
            map,
            mode,
            weapon = weapon ?? "",
            headshot,
            ranked,
            attacker_id = SteamIdOf(attacker).ToString(),
            attacker_name = attacker.PlayerName ?? "",
            attacker_bot = attacker.IsBot,
            victim_id = SteamIdOf(victim).ToString(),
            victim_name = victim.PlayerName ?? "",
            victim_bot = victim.IsBot,
        };
        lock (_sync)
        {
            if (_pendingKills.Count < 5000) _pendingKills.Add(kill);
            if (!attacker.IsBot) _dirty.Add(SteamIdOf(attacker));
            if (!victim.IsBot) _dirty.Add(SteamIdOf(victim));
        }
    }

    private void FlushStats()
    {
        if (string.IsNullOrWhiteSpace(Config.StatsUrl) || string.IsNullOrWhiteSpace(Config.StatsToken)) return;
        if (Interlocked.Exchange(ref _sending, 1) == 1) return;
        List<object> kills;
        List<PlayerDto> players;
        lock (_sync)
        {
            if (_pendingKills.Count == 0 && _dirty.Count == 0) { _sending = 0; return; }
            kills = _pendingKills.Take(500).ToList();
            _pendingKills.RemoveRange(0, kills.Count);
            players = _dirty.Where(_players.ContainsKey).Select(id => _players[id])
                .Select(p => new PlayerDto(p.SteamId.ToString(), p.Name, p.Points, p.Kills, p.Deaths, p.LastSeenUtc)).ToList();
            _dirty.Clear();
        }
        string url = Config.StatsUrl, token = Config.StatsToken;
        string body = JsonSerializer.Serialize(new { kills, players });
        Task.Run(async () =>
        {
            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Post, url) { Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json") };
                req.Headers.Add("x-ingest-token", token);
                using var res = await Http.SendAsync(req);
                if (!res.IsSuccessStatusCode) throw new Exception($"HTTP {(int)res.StatusCode}");
            }
            catch (Exception ex)
            {
                Logger.LogWarning("Statistik kunde inte skickas ({Msg}), försöker igen.", ex.Message);
                lock (_sync)
                {
                    if (_pendingKills.Count + kills.Count <= 5000) _pendingKills.InsertRange(0, kills);
                    foreach (var p in players) _dirty.Add(ulong.Parse(p.steam_id));
                }
            }
            finally { Interlocked.Exchange(ref _sending, 0); }
        });
    }

    private void SaveRankings()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_dataFile)!);
        string tmp = _dataFile + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(OrderedPlayers(), new JsonSerializerOptions { WriteIndented = true }));
        File.Move(tmp, _dataFile, true);
    }
}
