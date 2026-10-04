using System.Reflection;
using System.Text.Json;
using CounterStrikeSharp.API.Core.Plugin;
using CounterStrikeSharp.API.Core.Plugin.Host;
using Microsoft.Extensions.Logging;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Commands;
using CounterStrikeSharp.API.Modules.Cvars;
using CounterStrikeSharp.API.Modules.Utils;
using CounterStrikeSharp.API.Modules.Timers;

namespace GamlaSkolanPanelBridge;

[MinimumApiVersion(375)]
public class GamlaSkolanPanelBridgePlugin : BasePlugin
{
    public override string ModuleName => "Gamla Skolan Panel Bridge";
    public override string ModuleVersion => "2.1.0";
    public override string ModuleAuthor => "Gamla Skolan";
    public override string ModuleDescription => "Ger Gamla Skolan-panelen status och spelarkommandon via filer.";

    private DateTime _mapStart = DateTime.UtcNow;
    private string _dir = "";
    private string _cmdDir = "";
    private string _resDir = "";
    private DateTime _lastCleanup = DateTime.UtcNow;

    // Panelen pratar med servern via filer i stallet for RCON (som ar opalitligt i CS2):
    //   data/gs_panel/status.json   <- skrivs av pluginet varje sekund
    //   data/gs_panel/commands/*.json -> kommandon fran panelen, kors och tas bort
    //   data/gs_panel/results/*.json  <- svar pa kommandona
    public override void Load(bool hotReload)
    {
        RegisterListener<Listeners.OnMapStart>(_ => _mapStart = DateTime.UtcNow);
        _dir = Path.GetFullPath(Path.Combine(ModuleDirectory, "..", "..", "data", "gs_panel"));
        _cmdDir = Path.Combine(_dir, "commands");
        _resDir = Path.Combine(_dir, "results");
        Directory.CreateDirectory(_cmdDir);
        Directory.CreateDirectory(_resDir);
        AddTimer(1.0f, WriteStatus, TimerFlags.REPEAT);
        AddTimer(0.25f, PollCommands, TimerFlags.REPEAT);
    }

    private static void WriteAtomic(string file, string text)
    {
        var tmp = file + ".tmp";
        File.WriteAllText(tmp, text);
        File.Move(tmp, file, true);
    }

    private void WriteStatus()
    {
        try { WriteAtomic(Path.Combine(_dir, "status.json"), JsonSerializer.Serialize(BuildStatus())); }
        catch (Exception ex) { Logger.LogWarning("Kunde inte skriva status: {Msg}", ex.Message); }
    }

    private class PanelCommand
    {
        public string id { get; set; } = "";
        public string type { get; set; } = "exec";
        public string command { get; set; } = "";
        public int slot { get; set; } = -1;
        public string arg { get; set; } = "";
    }

    private void PollCommands()
    {
        string[] files;
        try { files = Directory.GetFiles(_cmdDir, "*.json").OrderBy(f => f).ToArray(); }
        catch { return; }
        foreach (var f in files)
        {
            PanelCommand? c = null;
            try
            {
                c = JsonSerializer.Deserialize<PanelCommand>(File.ReadAllText(f));
                File.Delete(f);
            }
            catch { try { File.Delete(f); } catch { } continue; }
            if (c == null || string.IsNullOrWhiteSpace(c.id)) continue;
            if (c.type == "exec")
            {
                // Kor kommandot och svara nasta frame, nar motorn hunnit verkstalla det.
                var cmd = c;
                try
                {
                    if (string.IsNullOrWhiteSpace(cmd.command)) throw new Exception("Tomt kommando");
                    Server.ExecuteCommand(cmd.command);
                    Server.NextFrame(() => Respond(cmd.id, true, DescribeExec(cmd.command)));
                }
                catch (Exception ex) { Respond(cmd.id, false, ex.Message); }
                continue;
            }
            string msg;
            bool ok = true;
            try { msg = Run(c); }
            catch (Exception ex) { ok = false; msg = ex.Message; }
            Respond(c.id, ok, msg);
        }
        if ((DateTime.UtcNow - _lastCleanup).TotalSeconds > 60)
        {
            _lastCleanup = DateTime.UtcNow;
            try { foreach (var r in Directory.GetFiles(_resDir)) if (File.GetLastWriteTimeUtc(r) < DateTime.UtcNow.AddMinutes(-2)) File.Delete(r); } catch { }
        }
    }

    private void Respond(string id, bool ok, string msg)
    {
        try { WriteAtomic(Path.Combine(_resDir, SafeId(id) + ".json"), JsonSerializer.Serialize(new { ok, msg, t = DateTime.UtcNow })); } catch { }
    }

    // Konsolen i CS2 gar inte att lasa fran ett plugin, sa vi svarar med det vi kan veta:
    // om kommandot ror en cvar visas dess (nya) varde.
    private static string DescribeExec(string command)
    {
        var parts = command.Trim().Split(' ', 2, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0) return "Kort";
        try
        {
            var cv = ConVar.Find(parts[0]);
            if (cv != null)
            {
                string val = cv.Type switch
                {
                    ConVarType.Bool => cv.GetPrimitiveValue<bool>() ? "1" : "0",
                    ConVarType.Float32 => cv.GetPrimitiveValue<float>().ToString(System.Globalization.CultureInfo.InvariantCulture),
                    ConVarType.Float64 => cv.GetPrimitiveValue<double>().ToString(System.Globalization.CultureInfo.InvariantCulture),
                    ConVarType.Int16 => cv.GetPrimitiveValue<short>().ToString(),
                    ConVarType.Int32 => cv.GetPrimitiveValue<int>().ToString(),
                    ConVarType.Int64 => cv.GetPrimitiveValue<long>().ToString(),
                    ConVarType.UInt16 => cv.GetPrimitiveValue<ushort>().ToString(),
                    ConVarType.UInt32 => cv.GetPrimitiveValue<uint>().ToString(),
                    ConVarType.UInt64 => cv.GetPrimitiveValue<ulong>().ToString(),
                    ConVarType.String => cv.StringValue,
                    _ => cv.StringValue,
                };
                return $"{cv.Name} = {val}";
            }
        }
        catch { }
        return "Kort";
    }

    // ---- plugins (via CSS:s pluginhanterare, som inte ar publik -> reflection) ----
    private static IPluginManager? _pm;
    private static IPluginManager? PM()
    {
        if (_pm != null) return _pm;
        try
        {
            var app = Application.Instance;
            var f = typeof(Application).GetField("_pluginManager", BindingFlags.NonPublic | BindingFlags.Instance);
            _pm = f?.GetValue(app) as IPluginManager;
        }
        catch { }
        return _pm;
    }

    private static string DirOf(PluginContext ctx)
    {
        try { return Path.GetFileNameWithoutExtension(ctx.FilePath); } catch { return ""; }
    }

    private object[] _pluginCache = Array.Empty<object>();
    private DateTime _pluginCacheAt = DateTime.MinValue;
    private object[] PluginInfo()
    {
        if ((DateTime.UtcNow - _pluginCacheAt).TotalSeconds < 3) return _pluginCache;
        _pluginCacheAt = DateTime.UtcNow;
        try
        {
            var pm = PM();
            if (pm == null) return _pluginCache = Array.Empty<object>();
            _pluginCache = pm.GetLoadedPlugins().Select(ctx =>
            {
                string name = "", version = "", author = "";
                try { name = ctx.Plugin?.ModuleName ?? ""; version = ctx.Plugin?.ModuleVersion ?? ""; author = ctx.Plugin?.ModuleAuthor ?? ""; } catch { }
                return (object)new { id = ctx.PluginId, dir = DirOf(ctx), name, version, author, state = ctx.State.ToString() };
            }).ToArray();
        }
        catch { }
        return _pluginCache;
    }

    private string PluginAction(string action, string dir)
    {
        var pm = PM() ?? throw new Exception("Hittar inte CSS:s pluginhanterare");
        if (string.Equals(dir, "GamlaSkolanPanelBridge", StringComparison.OrdinalIgnoreCase)) throw new Exception("Bryggan kan inte styra sig sjalv");
        var ctx = pm.GetLoadedPlugins().FirstOrDefault(p => string.Equals(DirOf(p), dir, StringComparison.OrdinalIgnoreCase));
        _pluginCacheAt = DateTime.MinValue;
        switch (action)
        {
            case "unload":
                if (ctx == null) throw new Exception("Pluginet ar inte laddat");
                ctx.Unload(false);
                return $"{dir} avlaget";
            case "reload":
                if (ctx == null) throw new Exception("Pluginet ar inte laddat");
                ctx.Unload(true);
                ctx.Load(true);
                return $"{dir} omladdat";
            case "load":
                if (ctx != null) { ctx.Load(false); return $"{dir} laddat"; }
                var dll = Path.GetFullPath(Path.Combine(ModuleDirectory, "..", dir, dir + ".dll"));
                if (!File.Exists(dll)) throw new Exception("Hittar inte " + dir + ".dll");
                pm.LoadPlugin(dll);
                return $"{dir} laddat";
            default:
                throw new Exception("Okand pluginatgard");
        }
    }

    private static string SafeId(string id) => new string(id.Where(ch => char.IsLetterOrDigit(ch) || ch == '-').Take(64).ToArray());

    private string Run(PanelCommand c)
    {
        switch (c.type)
        {
            case "say":
            {
                var text = (c.arg ?? "").Replace("\n", " ").Trim();
                if (text.Length == 0) throw new Exception("Tomt meddelande");
                Server.PrintToChatAll($" {ChatColors.Gold}[Gamla Skolan]{ChatColors.Default} {text}");
                return "Skickat";
            }
            case "plugin":
                return PluginAction(c.arg, c.command);
            case "kick":
            {
                var p = Slot(c.slot);
                var reason = string.IsNullOrWhiteSpace(c.arg) ? "Kickad av admin" : c.arg.Replace("\"", "'");
                if (p.IsBot) Server.ExecuteCommand($"bot_kick \"{p.PlayerName}\"");
                else Server.ExecuteCommand($"kickid {p.UserId} \"{reason}\"");
                return $"{p.PlayerName} kickad";
            }
            case "team":
            {
                var p = Slot(c.slot);
                var team = c.arg == "t" ? CsTeam.Terrorist : c.arg == "ct" ? CsTeam.CounterTerrorist : CsTeam.Spectator;
                if (team == CsTeam.Spectator) p.ChangeTeam(team); else p.SwitchTeam(team);
                return $"{p.PlayerName} -> {team}";
            }
            case "slay":
            {
                var p = Slot(c.slot);
                p.PlayerPawn.Value?.CommitSuicide(false, true);
                return $"{p.PlayerName} slayad";
            }
            default:
                throw new Exception("Okant kommando");
        }
    }

    private static CCSPlayerController Slot(int slot)
    {
        var p = Utilities.GetPlayerFromSlot(slot);
        if (p == null || !p.IsValid) throw new Exception("Hittade ingen spelare");
        return p;
    }

    private static bool ServerOnly(CCSPlayerController? caller) => caller == null;

    private static int Cvar(string name)
    {
        try { return ConVar.Find(name)?.GetPrimitiveValue<int>() ?? -1; } catch { return -1; }
    }

    private object BuildStatus()
    {
        var players = Utilities.GetPlayers()
            .Where(p => p != null && p.IsValid && !p.IsHLTV && p.Connected == PlayerConnectedState.Connected)
            .Select(p =>
            {
                var stats = p.ActionTrackingServices?.MatchStats;
                return new
                {
                    slot = p.Slot,
                    userid = p.UserId ?? -1,
                    name = p.PlayerName,
                    steamid = p.IsBot ? "" : (p.AuthorizedSteamID?.SteamId64 ?? p.SteamID).ToString(),
                    bot = p.IsBot,
                    team = p.Team switch { CsTeam.Terrorist => "T", CsTeam.CounterTerrorist => "CT", CsTeam.Spectator => "SPEC", _ => "-" },
                    alive = p.PawnIsAlive,
                    kills = stats?.Kills ?? 0,
                    deaths = stats?.Deaths ?? 0,
                    assists = stats?.Assists ?? 0,
                    score = p.Score,
                    mvps = p.MVPs,
                    ping = (int)p.Ping,
                };
            }).OrderByDescending(p => p.kills).ToList();

        return new
        {
            ok = true,
            t = DateTime.UtcNow,
            map = Server.MapName,
            maxPlayers = Server.MaxPlayers,
            gameType = Cvar("game_type"),
            gameMode = Cvar("game_mode"),
            mapUptimeSec = (int)(DateTime.UtcNow - _mapStart).TotalSeconds,
            plugins = PluginInfo(),
            players,
        };
    }

    [ConsoleCommand("gs_panel_status", "JSON-status for Gamla Skolan-panelen")]
    public void OnStatus(CCSPlayerController? caller, CommandInfo cmd)
    {
        if (!ServerOnly(caller)) return;
        // En rad med tydliga markorer sa att panelen kan plocka ut JSON ur RCON-svaret.
        cmd.ReplyToCommand("GSPANEL_JSON_BEGIN" + JsonSerializer.Serialize(BuildStatus()) + "GSPANEL_JSON_END");
    }

    private CCSPlayerController? BySlot(CommandInfo cmd)
    {
        if (cmd.ArgCount < 2 || !int.TryParse(cmd.GetArg(1), out var slot)) return null;
        var p = Utilities.GetPlayerFromSlot(slot);
        return p != null && p.IsValid ? p : null;
    }

    [ConsoleCommand("gs_panel_kick", "gs_panel_kick <slot> [anledning]")]
    public void OnKick(CCSPlayerController? caller, CommandInfo cmd)
    {
        if (!ServerOnly(caller)) return;
        var p = BySlot(cmd);
        if (p == null) { cmd.ReplyToCommand("GSPANEL_ERR Hittade ingen spelare"); return; }
        string reason = cmd.ArgCount > 2 ? cmd.ArgString.Substring(cmd.GetArg(1).Length).Trim().Trim('"') : "Kickad av admin";
        if (p.IsBot) Server.ExecuteCommand($"bot_kick \"{p.PlayerName}\"");
        else Server.ExecuteCommand($"kickid {p.UserId} \"{reason.Replace("\"", "'")}\"");
        cmd.ReplyToCommand($"GSPANEL_OK {p.PlayerName} kickad");
    }

    [ConsoleCommand("gs_panel_team", "gs_panel_team <slot> <t|ct|spec>")]
    public void OnTeam(CCSPlayerController? caller, CommandInfo cmd)
    {
        if (!ServerOnly(caller)) return;
        var p = BySlot(cmd);
        if (p == null || cmd.ArgCount < 3) { cmd.ReplyToCommand("GSPANEL_ERR Fel argument"); return; }
        var team = cmd.GetArg(2).ToLowerInvariant() switch
        {
            "t" => CsTeam.Terrorist,
            "ct" => CsTeam.CounterTerrorist,
            _ => CsTeam.Spectator,
        };
        if (team == CsTeam.Spectator) p.ChangeTeam(team); else p.SwitchTeam(team);
        cmd.ReplyToCommand($"GSPANEL_OK {p.PlayerName} -> {team}");
    }

    [ConsoleCommand("gs_panel_slay", "gs_panel_slay <slot>")]
    public void OnSlay(CCSPlayerController? caller, CommandInfo cmd)
    {
        if (!ServerOnly(caller)) return;
        var p = BySlot(cmd);
        if (p == null) { cmd.ReplyToCommand("GSPANEL_ERR Hittade ingen spelare"); return; }
        p.PlayerPawn.Value?.CommitSuicide(false, true);
        cmd.ReplyToCommand($"GSPANEL_OK {p.PlayerName} slayad");
    }
}
