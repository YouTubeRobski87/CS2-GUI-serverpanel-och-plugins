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
using Microsoft.Extensions.Logging;

namespace GamlaSkolanZombieMenu;

public class ZombieMenuConfig : BasePluginConfig
{
    [JsonPropertyName("Prefix")] public string Prefix { get; set; } = "{gold}[Server]{default}";
    // "en" eller "sv"
    [JsonPropertyName("Language")] public string Language { get; set; } = "en";
}

// Adminmeny för cs2-zombie-mode: !zm. Ändrar ZombieMode.json och kan be panelen starta om servern,
// eftersom zombie-pluginet bara läser sin config när det laddas.
[MinimumApiVersion(375)]
public class GamlaSkolanZombieMenuPlugin : BasePlugin, IPluginConfig<ZombieMenuConfig>
{
    public override string ModuleName => "Gamla Skolan Zombie Menu";
    public override string ModuleVersion => "1.0.0";
    public override string ModuleAuthor => "Gamla Skolan";
    public override string ModuleDescription => "Admin menu for cs2-zombie-mode settings: !zm";

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

    public override void Load(bool hotReload) => RegisterListener<Listeners.OnTick>(OnTick);

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
        for (int i = 0; i < ItemCount; i++)
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
        sb.Append($"<font color='#9b917f' class='fontSize-s'>{T("W/S: välj · A/D: ändra · E: spara · R: stäng", "W/S: select · A/D: change · E: save · R: close")}</font>");
        p.PrintToCenterHtml(sb.ToString());
    }
}
