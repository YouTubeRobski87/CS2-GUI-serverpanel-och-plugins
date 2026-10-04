using System.Text.Json.Serialization;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes;
using CounterStrikeSharp.API.Modules.Timers;

namespace GamlaSkolanAds;

public class AdsConfig : BasePluginConfig
{
    [JsonPropertyName("IntervalSeconds")] public float IntervalSeconds { get; set; } = 120f;

    [JsonPropertyName("Prefix")] public string Prefix { get; set; } = "{green}[Server]{default}";

    [JsonPropertyName("Messages")] public List<string> Messages { get; set; } = new()
    {
        "For new weapons type {green}!gun{default} - or just type the weapon name, e.g. {green}ak{default} or {green}awp{default}",
        "Check your rank with {green}!rank{default} and the leaderboard with {green}!top{default}",
        "First to {green}100 kills{default} wins the map!",
    };
}

[MinimumApiVersion(375)]
public class GamlaSkolanAdsPlugin : BasePlugin, IPluginConfig<AdsConfig>
{
    public override string ModuleName => "Gamla Skolan Ads";
    public override string ModuleVersion => "1.0.0";
    public override string ModuleAuthor => "Gamla Skolan";
    public override string ModuleDescription => "Automatiska tips i chatten med jamna mellanrum.";

    public AdsConfig Config { get; set; } = new();
    private int _next;

    public void OnConfigParsed(AdsConfig config)
    {
        config.IntervalSeconds = Math.Clamp(config.IntervalSeconds, 15f, 3600f);
        config.Messages = config.Messages.Where(m => !string.IsNullOrWhiteSpace(m)).ToList();
        Config = config;
    }

    public override void Load(bool hotReload)
    {
        // Ett enda upprepande timer som lever kvar over kartbyten.
        AddTimer(Config.IntervalSeconds, ShowNext, TimerFlags.REPEAT);
    }

    private void ShowNext()
    {
        if (Config.Messages.Count == 0) return;
        // Skicka bara nar det finns riktiga spelare inne.
        if (!Utilities.GetPlayers().Any(p => p.IsValid && !p.IsBot && !p.IsHLTV)) return;

        var msg = Config.Messages[_next % Config.Messages.Count];
        _next++;
        Server.PrintToChatAll($" {Colorize(Config.Prefix)} {Colorize(msg)}");
    }

    private static string Colorize(string s) => s
        .Replace("{default}", "\x01").Replace("{white}", "\x01")
        .Replace("{darkred}", "\x02").Replace("{red}", "\x07")
        .Replace("{green}", "\x04").Replace("{lime}", "\x06")
        .Replace("{lightgreen}", "\x05").Replace("{yellow}", "\x09")
        .Replace("{gold}", "\x10").Replace("{blue}", "\x0B")
        .Replace("{lightblue}", "\x0C").Replace("{purple}", "\x0E")
        .Replace("{grey}", "\x08").Replace("{orange}", "\x10");
}
