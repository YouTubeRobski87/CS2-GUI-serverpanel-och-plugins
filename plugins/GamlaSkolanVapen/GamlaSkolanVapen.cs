using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Core.Capabilities;
using CounterStrikeSharp.API.Modules.Commands;
using CounterStrikeSharp.API.Modules.Menu;
using CounterStrikeSharp.API.Modules.Utils;
using RetakesPluginShared;
using RetakesPluginShared.Events;

namespace GamlaSkolanVapen;

public class VapenConfig : BasePluginConfig
{
    [JsonPropertyName("PistolRounds")] public int PistolRounds { get; set; } = 3;
    [JsonPropertyName("AwpPerTeam")] public int AwpPerTeam { get; set; } = 1;
    [JsonPropertyName("BotsCanGetAwp")] public bool BotsCanGetAwp { get; set; } = true;
    [JsonPropertyName("Prefix")] public string Prefix { get; set; } = "{gold}[Gamla Skolan]{default}";
}

public class Prefs
{
    public string T { get; set; } = "weapon_ak47";
    public string CT { get; set; } = "weapon_m4a1_silencer";
    public string PistolT { get; set; } = "weapon_glock";
    public string PistolCT { get; set; } = "weapon_usp_silencer";
    public string Secondary { get; set; } = "weapon_deagle";
    public bool Awp { get; set; } = false;
}

[MinimumApiVersion(375)]
public class GamlaSkolanVapenPlugin : BasePlugin, IPluginConfig<VapenConfig>
{
    public override string ModuleName => "Gamla Skolan Vapenval";
    public override string ModuleVersion => "1.2.0";
    public override string ModuleAuthor => "Gamla Skolan";
    public override string ModuleDescription => "Vapenval för Retakes: !vapen";

    public VapenConfig Config { get; set; } = new();
    public void OnConfigParsed(VapenConfig config) => Config = config;

    private static readonly PluginCapability<IRetakesPluginEventSender> EventSender = new("retakes_plugin:event_sender");
    private IRetakesPluginEventSender? _sender;
    private readonly Random _rnd = new();
    private Dictionary<ulong, Prefs> _prefs = new();
    private string _prefsFile = "";

    // (vapennamn, visningsnamn)
    private static readonly (string id, string name)[] TRifles = { ("weapon_ak47", "AK-47"), ("weapon_galilar", "Galil AR"), ("weapon_sg556", "SG 553") };
    private static readonly (string id, string name)[] CTRifles = { ("weapon_m4a1_silencer", "M4A1-S"), ("weapon_m4a1", "M4A4"), ("weapon_famas", "FAMAS"), ("weapon_aug", "AUG") };
    private static readonly (string id, string name)[] TPistols = { ("weapon_glock", "Glock-18"), ("weapon_p250", "P250"), ("weapon_tec9", "Tec-9"), ("weapon_cz75a", "CZ75-Auto"), ("weapon_deagle", "Desert Eagle") };
    private static readonly (string id, string name)[] CTPistols = { ("weapon_usp_silencer", "USP-S"), ("weapon_hkp2000", "P2000"), ("weapon_fiveseven", "Five-SeveN"), ("weapon_p250", "P250"), ("weapon_cz75a", "CZ75-Auto"), ("weapon_deagle", "Desert Eagle") };
    private static readonly (string id, string name)[] Secondaries = { ("weapon_deagle", "Desert Eagle"), ("weapon_p250", "P250"), ("weapon_cz75a", "CZ75-Auto"), ("standard", "Lagets standardpistol") };

    public override void Load(bool hotReload)
    {
        var dataDir = Path.Combine(ModuleDirectory, "data");
        Directory.CreateDirectory(dataDir);
        _prefsFile = Path.Combine(dataDir, "vapenval.json");
        try
        {
            if (File.Exists(_prefsFile))
                _prefs = JsonSerializer.Deserialize<Dictionary<ulong, Prefs>>(File.ReadAllText(_prefsFile)) ?? new();
        }
        catch (Exception ex) { Logger.LogWarning("Kunde inte läsa vapenval: {Msg}", ex.Message); }
        RegisterListener<Listeners.OnTick>(OnTick);
        if (hotReload) Hook();
    }

    public override void OnAllPluginsLoaded(bool hotReload) => Hook();

    public override void Unload(bool hotReload)
    {
        if (_sender != null) _sender.RetakesPluginEventHandlers -= OnRetakesEvent;
        _sender = null;
    }

    private void Hook()
    {
        if (_sender != null) return;
        try { _sender = EventSender.Get(); } catch { _sender = null; }
        if (_sender == null) { Logger.LogWarning("Hittar inte RetakesPlugin – vapenval är av."); return; }
        _sender.RetakesPluginEventHandlers += OnRetakesEvent;
        Logger.LogInformation("Kopplad till RetakesPlugin.");
    }

    [GameEventHandler]
    public HookResult OnRoundPreStart(EventRoundPrestart e, GameEventInfo info)
    {
        Hook(); // om Retakes laddades efter oss
        return HookResult.Continue;
    }

    private void OnRetakesEvent(object? sender, IRetakesPluginEvent e)
    {
        if (e is AllocateEvent) Server.NextFrame(AllocateAll);
    }

    private string Color(string s) => s
        .Replace("{gold}", $"{ChatColors.Gold}").Replace("{default}", $"{ChatColors.Default}")
        .Replace("{green}", $"{ChatColors.Green}").Replace("{red}", $"{ChatColors.Red}")
        .Replace("{lightred}", $"{ChatColors.LightRed}").Replace("{blue}", $"{ChatColors.Blue}");

    private string P => Color(Config.Prefix);

    private Prefs PrefsFor(CCSPlayerController p)
    {
        if (p.IsBot)
        {
            return new Prefs
            {
                T = TRifles[_rnd.Next(TRifles.Length)].id,
                CT = CTRifles[_rnd.Next(CTRifles.Length)].id,
                PistolT = TPistols[_rnd.Next(TPistols.Length)].id,
                PistolCT = CTPistols[_rnd.Next(CTPistols.Length)].id,
                Secondary = "weapon_deagle",
            };
        }
        if (!_prefs.TryGetValue(p.SteamID, out var pr)) { pr = new Prefs(); }
        return pr;
    }

    private void Save()
    {
        try { File.WriteAllText(_prefsFile, JsonSerializer.Serialize(_prefs, new JsonSerializerOptions { WriteIndented = true })); }
        catch (Exception ex) { Logger.LogWarning("Kunde inte spara vapenval: {Msg}", ex.Message); }
    }

    private int RoundsPlayed()
    {
        try
        {
            var rules = Utilities.FindAllEntitiesByDesignerName<CCSGameRulesProxy>("cs_gamerules").FirstOrDefault()?.GameRules;
            return rules?.TotalRoundsPlayed ?? 99;
        }
        catch { return 99; }
    }

    private void AllocateAll()
    {
        var players = Utilities.GetPlayers()
            .Where(p => p != null && p.IsValid && !p.IsHLTV && p.PawnIsAlive && (p.Team == CsTeam.Terrorist || p.Team == CsTeam.CounterTerrorist))
            .ToList();
        if (players.Count == 0) return;

        int played = RoundsPlayed();
        bool pistol = played < Config.PistolRounds;

        // AWP: max AwpPerTeam per lag, slumpas bland de som vill ha (bottar som reserv).
        var awpers = new HashSet<ulong>();
        if (!pistol)
        {
            foreach (var team in new[] { CsTeam.Terrorist, CsTeam.CounterTerrorist })
            {
                var onTeam = players.Where(p => p.Team == team).ToList();
                var wanting = onTeam.Where(p => !p.IsBot && PrefsFor(p).Awp).OrderBy(_ => _rnd.Next()).ToList();
                if (wanting.Count == 0 && Config.BotsCanGetAwp && _rnd.NextDouble() < 0.35)
                    wanting = onTeam.Where(p => p.IsBot).OrderBy(_ => _rnd.Next()).ToList();
                foreach (var w in wanting.Take(Math.Max(0, Config.AwpPerTeam))) awpers.Add(w.Index);
            }
        }

        foreach (var p in players)
        {
            try { Give(p, pistol, awpers.Contains(p.Index)); }
            catch (Exception ex) { Logger.LogWarning("Kunde inte ge vapen till {Name}: {Msg}", p.PlayerName, ex.Message); }
        }

        if (pistol)
            Server.PrintToChatAll($" {P} {ChatColors.Green}Pistolrunda{ChatColors.Default} ({played + 1}/{Config.PistolRounds}) – skriv {ChatColors.Gold}!vapen{ChatColors.Default} för att välja vapen.");
        else if (played == Config.PistolRounds)
            Server.PrintToChatAll($" {P} {ChatColors.Green}Fullköp{ChatColors.Default} från och med nu – lycka till!");
    }

    private void Give(CCSPlayerController p, bool pistol, bool awp)
    {
        var pawn = p.PlayerPawn.Value;
        if (pawn == null || !pawn.IsValid) return;
        var pr = PrefsFor(p);
        bool isT = p.Team == CsTeam.Terrorist;

        bool hadC4 = pawn.WeaponServices?.MyWeapons.Any(w => w.Value?.DesignerName == "weapon_c4") ?? false;
        p.RemoveWeapons();
        p.GiveNamedItem("weapon_knife");
        if (hadC4) p.GiveNamedItem("weapon_c4");

        if (pistol)
        {
            p.GiveNamedItem(isT ? pr.PistolT : pr.PistolCT);
            p.GiveNamedItem("item_kevlar");
            if (_rnd.NextDouble() < 0.5) p.GiveNamedItem(new[] { "weapon_flashbang", "weapon_smokegrenade", "weapon_hegrenade" }[_rnd.Next(3)]);
        }
        else
        {
            p.GiveNamedItem(awp ? "weapon_awp" : (isT ? pr.T : pr.CT));
            var sec = pr.Secondary == "standard" ? (isT ? "weapon_glock" : "weapon_usp_silencer") : pr.Secondary;
            p.GiveNamedItem(sec);
            p.GiveNamedItem("item_assaultsuit");
            var nades = new[] { "weapon_smokegrenade", "weapon_flashbang", "weapon_hegrenade", isT ? "weapon_molotov" : "weapon_incgrenade" };
            p.GiveNamedItem(nades[_rnd.Next(nades.Length)]);
            if (_rnd.NextDouble() < 0.4) p.GiveNamedItem("weapon_flashbang");
        }

        var items = pawn.ItemServices == null ? null : new CCSPlayer_ItemServices(pawn.ItemServices.Handle);
        if (items != null)
        {
            items.HasHelmet = !pistol;
            if (!isT) items.HasDefuser = true;
        }
    }

    // ------------------------------------------------------------------ meny

    [ConsoleCommand("css_vapen", "Välj vapen för retakes")]
    [ConsoleCommand("css_guns", "Välj vapen för retakes")]
    [ConsoleCommand("css_gun", "Välj vapen för retakes")]
    [CommandHelper(whoCanExecute: CommandUsage.CLIENT_ONLY)]
    public void OnVapen(CCSPlayerController? player, CommandInfo cmd)
    {
        if (player == null || !player.IsValid || player.IsBot) return;
        OpenMain(player);
    }

    private static string NameOf((string id, string name)[] list, string id) => list.FirstOrDefault(x => x.id == id).name ?? id;

    private Prefs Mine(CCSPlayerController p)
    {
        if (!_prefs.TryGetValue(p.SteamID, out var pr)) { pr = new Prefs(); _prefs[p.SteamID] = pr; }
        return pr;
    }

    // ---- egen meny som styrs med tangenterna (W/S, E, A, R) – inget !1/!2 i chatten ----

    private class MenuState
    {
        public string Title = "";
        public List<(string text, Action<CCSPlayerController> pick)> Items = new();
        public Action<CCSPlayerController>? Back;
        public int Sel;
        public PlayerButtons Last;
        public DateTime Opened = DateTime.UtcNow;
    }

    private readonly Dictionary<int, MenuState> _menus = new();

    private void ShowMenu(CCSPlayerController player, string title, List<(string, Action<CCSPlayerController>)> items, Action<CCSPlayerController>? back, int sel = 0)
    {
        _menus[player.Slot] = new MenuState
        {
            Title = title,
            Items = items,
            Back = back,
            Sel = Math.Clamp(sel, 0, Math.Max(0, items.Count - 1)),
            Last = player.Buttons, // knappar som redan hålls ner räknas inte som tryck
        };
    }

    private void CloseMenu(CCSPlayerController player)
    {
        if (_menus.Remove(player.Slot)) player.PrintToCenterHtml(" ");
    }

    private void OnTick()
    {
        if (_menus.Count == 0) return;
        foreach (var slot in _menus.Keys.ToList())
        {
            if (!_menus.TryGetValue(slot, out var m)) continue;
            var p = Utilities.GetPlayerFromSlot(slot);
            if (p == null || !p.IsValid || p.IsBot) { _menus.Remove(slot); continue; }

            var now = p.Buttons;
            var pressed = now & ~m.Last;
            m.Last = now;

            if ((pressed & PlayerButtons.Forward) != 0) m.Sel = (m.Sel - 1 + m.Items.Count) % m.Items.Count;
            else if ((pressed & PlayerButtons.Back) != 0) m.Sel = (m.Sel + 1) % m.Items.Count;
            else if ((pressed & PlayerButtons.Use) != 0) { m.Items[m.Sel].pick(p); if (_menus.TryGetValue(slot, out var nm) && nm != m) Render(p, nm); else if (!_menus.ContainsKey(slot)) continue; }
            else if ((pressed & PlayerButtons.Moveleft) != 0 && m.Back != null) { m.Back(p); continue; }
            else if ((pressed & PlayerButtons.Reload) != 0 || (DateTime.UtcNow - m.Opened).TotalSeconds > 60) { CloseMenu(p); continue; }

            if (_menus.TryGetValue(slot, out var cur)) Render(p, cur);
        }
    }

    private static string Esc(string s) => s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;");

    private void Render(CCSPlayerController p, MenuState m)
    {
        var sb = new System.Text.StringBuilder();
        sb.Append($"<font color='#f5a524' class='fontSize-m'>{Esc(m.Title)}</font><br>");
        for (int i = 0; i < m.Items.Count; i++)
        {
            if (i == m.Sel) sb.Append($"<font color='#7CFC00'>▶ {Esc(m.Items[i].text)}</font><br>");
            else sb.Append($"<font color='#ffffff'>{Esc(m.Items[i].text)}</font><br>");
        }
        sb.Append(m.Back != null
            ? "<font color='#9b917f' class='fontSize-s'>W/S: bläddra · E: välj · A: tillbaka · R: stäng</font>"
            : "<font color='#9b917f' class='fontSize-s'>W/S: bläddra · E: välj · R: stäng</font>");
        p.PrintToCenterHtml(sb.ToString());
    }

    private void OpenMain(CCSPlayerController player, int sel = 0)
    {
        var pr = Mine(player);
        var items = new List<(string, Action<CCSPlayerController>)>
        {
            ($"T-gevär: {NameOf(TRifles, pr.T)}", p => Pick(p, 0, "T-gevär", TRifles, pr.T, id => { Mine(p).T = id; RifleChosen(p); })),
            ($"CT-gevär: {NameOf(CTRifles, pr.CT)}", p => Pick(p, 1, "CT-gevär", CTRifles, pr.CT, id => { Mine(p).CT = id; RifleChosen(p); })),
            ($"AWP: {(pr.Awp ? "Ja (ersätter gevär)" : "Nej")}", p =>
            {
                var me = Mine(p);
                me.Awp = !me.Awp;
                Save();
                p.PrintToChat($" {P} AWP är nu {(me.Awp ? $"{ChatColors.Green}på" : $"{ChatColors.Red}av")}{ChatColors.Default}. (En per lag och runda slumpas bland de som vill.)");
                OpenMain(p, 2);
            }),
            ($"Sidovapen: {NameOf(Secondaries, pr.Secondary)}", p => Pick(p, 3, "Sidovapen (fullköp)", Secondaries, pr.Secondary, id => Mine(p).Secondary = id)),
            ($"Pistolrunda T: {NameOf(TPistols, pr.PistolT)}", p => Pick(p, 4, "Pistolrunda T", TPistols, pr.PistolT, id => Mine(p).PistolT = id)),
            ($"Pistolrunda CT: {NameOf(CTPistols, pr.PistolCT)}", p => Pick(p, 5, "Pistolrunda CT", CTPistols, pr.PistolCT, id => Mine(p).PistolCT = id)),
        };
        ShowMenu(player, "Gamla Skolan – vapenval", items, null, sel);
    }

    // Väljer man ett gevär vill man ha det – då stängs AWP av (annars vinner AWP varje runda).
    private void RifleChosen(CCSPlayerController p)
    {
        var me = Mine(p);
        if (!me.Awp) return;
        me.Awp = false;
        p.PrintToChat($" {P} AWP är nu {ChatColors.Red}av{ChatColors.Default} eftersom du valde gevär. Slå på den igen i {ChatColors.Gold}!vapen{ChatColors.Default} om du vill ha AWP.");
    }

    private void Pick(CCSPlayerController player, int mainIndex, string title, (string id, string name)[] list, string current, Action<string> set)
    {
        var items = list.Select(w => (w.name, (Action<CCSPlayerController>)(p =>
        {
            set(w.id);
            Save();
            p.PrintToChat($" {P} {title}: {ChatColors.Green}{w.name}{ChatColors.Default} – gäller från nästa runda.");
            OpenMain(p, mainIndex);
        }))).ToList();
        var sel = Math.Max(0, Array.FindIndex(list, w => w.id == current));
        ShowMenu(player, title, items, p => OpenMain(p, mainIndex), sel);
    }
}
