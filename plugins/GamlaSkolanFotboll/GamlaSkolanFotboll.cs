using System.Drawing;
using System.Text.Json;
using System.Text.Json.Serialization;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Admin;
using CounterStrikeSharp.API.Modules.Cvars;
using CounterStrikeSharp.API.Modules.Entities.Constants;
using CounterStrikeSharp.API.Modules.Memory;
using CounterStrikeSharp.API.Modules.Memory.DynamicFunctions;
using CounterStrikeSharp.API.Modules.Timers;
using CounterStrikeSharp.API.Modules.Utils;
using Microsoft.Extensions.Logging;

namespace GamlaSkolanFotboll;

public class FotbollConfig : BasePluginConfig
{
    // Antal mål som vinner matchen
    [JsonPropertyName("GoalsToWin")] public int GoalsToWin { get; set; } = 7;
    // Sekunder från mål till avspark
    [JsonPropertyName("KickoffDelay")] public float KickoffDelay { get; set; } = 4f;
    // Hur nära bollen (enheter) en spelare ska vara för att räknas som den som rörde den senast
    [JsonPropertyName("TouchDistance")] public float TouchDistance { get; set; } = 90f;
    // Ljud som spelas för alla vid mål och vinst (sökväg till en .vsnd i spelet, tomt = inget ljud)
    [JsonPropertyName("GoalSound")] public string GoalSound { get; set; } = "sounds/ui/xp_levelup.vsnd_c";
    [JsonPropertyName("WinSound")] public string WinSound { get; set; } = "sounds/music/valve_cs2_01/roundmvpanthem_01.vsnd_c";
}

// Fotbollsläget (CS2 Football-banan, game_type 3):
//  - spelare tar ingen skada, så kniven bara sparkar bollen
//  - mål räknas när bollen (BALL) går in i ett mål (CTGOAL = CT gör mål, TGOAL = T gör mål)
//  - avspark efter varje mål, vinnare vid GoalsToWin mål
// Gör ingenting i andra lägen eller på banor utan BALL.
[MinimumApiVersion(375)]
public class GamlaSkolanFotbollPlugin : BasePlugin, IPluginConfig<FotbollConfig>
{
    public override string ModuleName => "Gamla Skolan Fotboll";
    public override string ModuleVersion => "1.5.0";
    public override string ModuleAuthor => "Gamla Skolan";
    public override string ModuleDescription => "Fotboll: ingen skada, mål, avspark och vinnare";

    public FotbollConfig Config { get; set; } = new();
    public void OnConfigParsed(FotbollConfig config) => Config = config;

    private CBaseEntity? _ball;
    private CBaseEntity? _goalCt;   // bollen här = CT gör mål
    private CBaseEntity? _goalT;    // bollen här = T gör mål
    private Vector? _ballStart;
    private QAngle? _ballStartAng;

    private int _scoreCt;
    private int _scoreT;
    private bool _goalLock;          // spärr mellan mål och avspark
    private CCSPlayerController? _lastTouch;
    private CCSPlayerController? _prevTouch;

    // Stort meddelande mitt på skärmen. Skickas om varje tick, annars skrivs det över direkt.
    private string? _center;

    // Egna resultattavlor (point_worldtext) som admin placerar ut med !tavla. Sparas per bana i tavlor.json.
    private readonly List<CPointWorldText> _boards = new();
    private record BoardPos(float X, float Y, float Z, float Yaw);
    private Dictionary<string, List<BoardPos>> _boardPos = new();
    private DateTime _centerUntil;

    public override void Load(bool hotReload)
    {
        RegisterListener<Listeners.OnEntityTakeDamagePre>((victim, info) =>
            IsFootballMode() && victim != null && victim.DesignerName == "player" ? HookResult.Handled : HookResult.Continue);
        HookEntityOutput("*", "OnStartTouch", OnStartTouch, HookMode.Post);
        RegisterListener<Listeners.OnMapStart>(_ => ResetMatch(clearBallStart: true));
        AddTimer(0.1f, Tick, TimerFlags.REPEAT);
        RegisterListener<Listeners.OnTick>(OnTickCenter);
        LoadBoardPositions();
        if (hotReload) ResetMatch(clearBallStart: true);
    }

    // ---------------------------------------------------------------- hjälp

    private static bool IsFootballMode()
    {
        var gt = ConVar.Find("game_type");
        return gt != null && gt.GetPrimitiveValue<int>() == 3;
    }

    private static string? NameOf(CEntityInstance? e)
    {
        try { return e?.Entity?.Name; } catch { return null; }
    }

    private void FindEntities()
    {
        _ball = null; _goalCt = null; _goalT = null;
        foreach (var e in Utilities.GetAllEntities())
        {
            var n = NameOf(e);
            if (string.IsNullOrEmpty(n)) continue;
            if (n.Equals("BALL", StringComparison.OrdinalIgnoreCase)) _ball = e.As<CBaseEntity>();
            else if (n.Equals("CTGOAL", StringComparison.OrdinalIgnoreCase)) _goalCt = e.As<CBaseEntity>();
            else if (n.Equals("TGOAL", StringComparison.OrdinalIgnoreCase)) _goalT = e.As<CBaseEntity>();
        }
        if (_ball != null && _ball.IsValid && _ballStart == null && _ball.AbsOrigin != null)
        {
            _ballStart = new Vector(_ball.AbsOrigin.X, _ball.AbsOrigin.Y, _ball.AbsOrigin.Z);
            var a = _ball.AbsRotation;
            _ballStartAng = a == null ? new QAngle(0, 0, 0) : new QAngle(a.X, a.Y, a.Z);
        }
    }

    private bool Active => IsFootballMode() && _ball != null && _ball.IsValid;

    private void ResetMatch(bool clearBallStart)
    {
        _scoreCt = 0; _scoreT = 0; _goalLock = false;
        _lastTouch = null; _prevTouch = null;
        if (clearBallStart) { _ballStart = null; _ballStartAng = null; }
        _ball = null; _goalCt = null; _goalT = null;
    }

    private void ShowCenter(string html, float seconds)
    {
        _center = html;
        _centerUntil = DateTime.UtcNow.AddSeconds(seconds);
    }

    private void OnTickCenter()
    {
        if (_center == null) return;
        if (DateTime.UtcNow > _centerUntil) { _center = null; return; }
        foreach (var p in Utilities.GetPlayers())
            if (p is { IsValid: true, IsBot: false }) p.PrintToCenterHtml(_center);
    }

    private string BoardFile => Path.Combine(ModuleDirectory, "tavlor.json");

    private void LoadBoardPositions()
    {
        try
        {
            if (File.Exists(BoardFile))
                _boardPos = JsonSerializer.Deserialize<Dictionary<string, List<BoardPos>>>(File.ReadAllText(BoardFile)) ?? new();
        }
        catch (Exception ex) { Logger.LogWarning("Kunde inte läsa tavlor.json: {Msg}", ex.Message); }
    }

    private void SaveBoardPositions()
    {
        try { File.WriteAllText(BoardFile, JsonSerializer.Serialize(_boardPos, new JsonSerializerOptions { WriteIndented = true })); }
        catch (Exception ex) { Logger.LogWarning("Kunde inte spara tavlor.json: {Msg}", ex.Message); }
    }

    private string BoardText() => $"CT  {_scoreCt}  -  {_scoreT}  T";

    private CPointWorldText? SpawnBoard(BoardPos b)
    {
        var wt = Utilities.CreateEntityByName<CPointWorldText>("point_worldtext");
        if (wt == null) return null;
        wt.MessageText = BoardText();
        wt.Enabled = true;
        wt.FontSize = 120;
        wt.Fullbright = true;
        wt.WorldUnitsPerPx = 0.25f;
        wt.Color = Color.White;
        wt.JustifyHorizontal = PointWorldTextJustifyHorizontal_t.POINT_WORLD_TEXT_JUSTIFY_HORIZONTAL_CENTER;
        wt.JustifyVertical = PointWorldTextJustifyVertical_t.POINT_WORLD_TEXT_JUSTIFY_VERTICAL_CENTER;
        wt.DrawBackground = true;
        wt.BackgroundBorderWidth = 2f;
        wt.BackgroundBorderHeight = 1f;
        wt.DispatchSpawn();
        wt.Teleport(new Vector(b.X, b.Y, b.Z), new QAngle(0, b.Yaw + 270f, 90f), new Vector(0, 0, 0));
        return wt;
    }

    private void SpawnBoards()
    {
        foreach (var b in _boards) if (b.IsValid) b.Remove();
        _boards.Clear();
        if (!IsFootballMode()) return;
        if (!_boardPos.TryGetValue(Server.MapName, out var list)) return;
        foreach (var b in list) { var wt = SpawnBoard(b); if (wt != null) _boards.Add(wt); }
    }

    private void UpdateBoards()
    {
        var text = BoardText();
        foreach (var b in _boards)
        {
            if (!b.IsValid) continue;
            b.MessageText = text;
            Utilities.SetStateChanged(b, "CPointWorldText", "m_messageText");
        }
    }

    [ConsoleCommand("css_tavla", "Sätter en resultattavla där du tittar (fotboll)")]
    [RequiresPermissions("@css/root")]
    public void OnBoardAdd(CCSPlayerController? caller, CounterStrikeSharp.API.Modules.Commands.CommandInfo cmd)
    {
        var pawn = caller?.PlayerPawn.Value;
        if (caller == null || pawn == null || pawn.AbsOrigin == null) { cmd.ReplyToCommand("Kör kommandot i spelet."); return; }
        var eye = pawn.EyeAngles;
        float yaw = eye.Y;
        float rad = yaw * MathF.PI / 180f;
        // 120 enheter framför dig, i ögonhöjd + lite till
        var pos = new BoardPos(pawn.AbsOrigin.X + MathF.Cos(rad) * 120f, pawn.AbsOrigin.Y + MathF.Sin(rad) * 120f, pawn.AbsOrigin.Z + 90f, yaw);
        if (!_boardPos.TryGetValue(Server.MapName, out var list)) { list = new(); _boardPos[Server.MapName] = list; }
        list.Add(pos);
        SaveBoardPositions();
        SpawnBoards();
        cmd.ReplyToCommand($" {ChatColors.Gold}Tavla {list.Count} sparad.{ChatColors.Default} Ta bort alla med !tavla_bort");
    }

    [ConsoleCommand("css_tavla_bort", "Tar bort alla resultattavlor på banan")]
    [RequiresPermissions("@css/root")]
    public void OnBoardClear(CCSPlayerController? caller, CounterStrikeSharp.API.Modules.Commands.CommandInfo cmd)
    {
        _boardPos.Remove(Server.MapName);
        SaveBoardPositions();
        SpawnBoards();
        cmd.ReplyToCommand("Alla tavlor borttagna.");
    }

    // Skickar en input till alla entiteter med ett visst namn på banan (t.ex. fyrverkerier och visselpipa)
    private static void FireNamed(string name, string input)
    {
        foreach (var e in Utilities.GetAllEntities())
        {
            if (!string.Equals(NameOf(e), name, StringComparison.OrdinalIgnoreCase)) continue;
            try { e.AcceptInput(input); } catch { /* entiteten tar inte emot den inputen */ }
        }
    }

    // Lagens poäng överst på skärmen (HUD) följer målen
    private void SetTeamScores()
    {
        UpdateBoards();
        foreach (var t in Utilities.FindAllEntitiesByDesignerName<CCSTeam>("cs_team_manager"))
        {
            if (t.TeamNum == (int)CsTeam.CounterTerrorist) t.Score = _scoreCt;
            else if (t.TeamNum == (int)CsTeam.Terrorist) t.Score = _scoreT;
            else continue;
            Utilities.SetStateChanged(t, "CTeam", "m_iScore");
        }
    }

    private static void PlayToAll(string sound)
    {
        if (string.IsNullOrWhiteSpace(sound)) return;
        foreach (var p in Utilities.GetPlayers().Where(p => p is { IsValid: true, IsBot: false }))
            p.ExecuteClientCommand($"play {sound}");
    }

    private static string Team(CsTeam t) => t == CsTeam.CounterTerrorist ? "CT" : "T";
    private static char TeamColor(CsTeam t) => t == CsTeam.CounterTerrorist ? ChatColors.Blue : ChatColors.Yellow;

    private string ScoreLine() =>
        $" {ChatColors.Blue}CT {_scoreCt}{ChatColors.Default} – {ChatColors.Yellow}{_scoreT} T{ChatColors.Default}";

    // ---------------------------------------------------------------- vem rörde bollen

    private void Tick()
    {
        if (!IsFootballMode()) return;
        if (_ball == null || !_ball.IsValid) { FindEntities(); if (_ball == null) return; }
        var bp = _ball.AbsOrigin;
        if (bp == null) return;

        CCSPlayerController? nearest = null;
        float best = Config.TouchDistance;
        foreach (var p in Utilities.GetPlayers())
        {
            if (p == null || !p.IsValid || p.Team is not (CsTeam.CounterTerrorist or CsTeam.Terrorist)) continue;
            var pawn = p.PlayerPawn.Value;
            if (pawn == null || !pawn.IsValid || pawn.LifeState != (byte)LifeState_t.LIFE_ALIVE || pawn.AbsOrigin == null) continue;
            var o = pawn.AbsOrigin;
            float dx = o.X - bp.X, dy = o.Y - bp.Y, dz = (o.Z + 36f) - bp.Z;
            float d = MathF.Sqrt(dx * dx + dy * dy + dz * dz);
            if (d < best) { best = d; nearest = p; }
        }
        if (nearest != null && nearest != _lastTouch) { _prevTouch = _lastTouch; _lastTouch = nearest; }

        // Reserv om banans mål inte skickar OnStartTouch för bollen: kolla om bollen är inne i målets ruta
        if (!_goalLock)
        {
            if (Inside(_goalCt, bp)) Goal(CsTeam.CounterTerrorist);
            else if (Inside(_goalT, bp)) Goal(CsTeam.Terrorist);
        }
    }

    private static bool Inside(CBaseEntity? trig, Vector p)
    {
        if (trig == null || !trig.IsValid || trig.AbsOrigin == null || trig.Collision == null) return false;
        var o = trig.AbsOrigin; var mn = trig.Collision.Mins; var mx = trig.Collision.Maxs;
        if (mn == null || mx == null) return false;
        return p.X >= o.X + mn.X && p.X <= o.X + mx.X
            && p.Y >= o.Y + mn.Y && p.Y <= o.Y + mx.Y
            && p.Z >= o.Z + mn.Z && p.Z <= o.Z + mx.Z;
    }

    // ---------------------------------------------------------------- mål

    private HookResult OnStartTouch(CEntityIOOutput output, string name, CEntityInstance activator, CEntityInstance caller, CVariant value, float delay)
    {
        if (_goalLock || !IsFootballMode()) return HookResult.Continue;
        if (!string.Equals(NameOf(activator), "BALL", StringComparison.OrdinalIgnoreCase)) return HookResult.Continue;
        var goal = NameOf(caller);
        if (string.Equals(goal, "CTGOAL", StringComparison.OrdinalIgnoreCase)) Server.NextFrame(() => Goal(CsTeam.CounterTerrorist));
        else if (string.Equals(goal, "TGOAL", StringComparison.OrdinalIgnoreCase)) Server.NextFrame(() => Goal(CsTeam.Terrorist));
        return HookResult.Continue;
    }

    private void Goal(CsTeam scoring)
    {
        if (_goalLock || !Active) return;
        _goalLock = true;

        if (scoring == CsTeam.CounterTerrorist) _scoreCt++; else _scoreT++;

        var who = _lastTouch != null && _lastTouch.IsValid ? _lastTouch : null;
        string text;
        if (who == null) text = $"{TeamColor(scoring)}{Team(scoring)}{ChatColors.Default} gör mål!";
        else if (who.Team == scoring) text = $"{TeamColor(scoring)}{who.PlayerName}{ChatColors.Default} gör mål för {TeamColor(scoring)}{Team(scoring)}{ChatColors.Default}!";
        else text = $"Självmål av {ChatColors.Red}{who.PlayerName}{ChatColors.Default} – poäng till {TeamColor(scoring)}{Team(scoring)}{ChatColors.Default}!";

        PlayToAll(Config.GoalSound);
        // Banans egna målfirande: fyrverkerier och smäll vid målet
        var side = scoring == CsTeam.CounterTerrorist ? "CT" : "T";
        FireNamed($"{side}SCORE", "Start");
        FireNamed($"{side}SCOREEX", "Explode");
        SetTeamScores();
        Server.PrintToChatAll($" {ChatColors.Gold}⚽ MÅL!{ChatColors.Default} {text}");
        Server.PrintToChatAll(ScoreLine());
        var centerWho = who == null ? Team(scoring) : who.PlayerName;
        ShowCenter($"<font color='#f5c542' class='fontSize-xl'>MÅL!</font><br>{System.Net.WebUtility.HtmlEncode(centerWho)}<br><font color='#5fa8ff'>CT {_scoreCt}</font> – <font color='#ffd34d'>{_scoreT} T</font>", Config.KickoffDelay);
        Logger.LogInformation("Mål för {Team} ({Who}), CT {Ct} – T {T}", Team(scoring), who?.PlayerName ?? "-", _scoreCt, _scoreT);

        if (_scoreCt >= Config.GoalsToWin || _scoreT >= Config.GoalsToWin)
        {
            var winner = _scoreCt >= Config.GoalsToWin ? CsTeam.CounterTerrorist : CsTeam.Terrorist;
            AddTimer(2f, () =>
            {
                PlayToAll(Config.WinSound);
                Server.PrintToChatAll($" {ChatColors.Gold}🏆 {TeamColor(winner)}{Team(winner)}{ChatColors.Gold} vinner matchen!{ChatColors.Default}{ScoreLine()}");
                ShowCenter($"<font color='#f5c542' class='fontSize-xl'>{Team(winner)} VINNER!</font><br><font color='#5fa8ff'>CT {_scoreCt}</font> – <font color='#ffd34d'>{_scoreT} T</font><br>Ny match börjar strax", 6f);
            });
            AddTimer(Config.KickoffDelay + 4f, () =>
            {
                _scoreCt = 0; _scoreT = 0;
                Server.PrintToChatAll($" {ChatColors.Gold}⚽ Ny match!{ChatColors.Default} Först till {Config.GoalsToWin} mål vinner.");
                Kickoff();
            });
            return;
        }

        AddTimer(Config.KickoffDelay, Kickoff);
    }

    // ---------------------------------------------------------------- avspark

    private void Kickoff()
    {
        if (!IsFootballMode()) { _goalLock = false; return; }
        if (_ball == null || !_ball.IsValid) FindEntities();
        if (_ball != null && _ball.IsValid && _ballStart != null)
            _ball.Teleport(_ballStart, _ballStartAng ?? new QAngle(0, 0, 0), new Vector(0, 0, 0));

        // Alla tillbaka till sitt lag startpositioner
        foreach (var p in Utilities.GetPlayers())
        {
            if (p == null || !p.IsValid || p.Team is not (CsTeam.CounterTerrorist or CsTeam.Terrorist)) continue;
            try { p.Respawn(); } catch { /* spelaren kan inte respawnas just nu */ }
        }

        _lastTouch = null; _prevTouch = null;
        FireNamed("CTSCORE", "Stop");
        FireNamed("TSCORE", "Stop");
        FireNamed("whistle", "StartSound");
        SetTeamScores();
        Server.PrintToChatAll($" {ChatColors.Gold}⚽ Avspark!{ChatColors.Default}{ScoreLine()}");
        // Kort spärr så att bollen hinner landa på mittpunkten innan mål räknas igen
        AddTimer(1.5f, () => _goalLock = false);
    }

    // ---------------------------------------------------------------- händelser

    [GameEventHandler]
    public HookResult OnRoundStart(EventRoundStart e, GameEventInfo info)
    {
        if (!IsFootballMode()) return HookResult.Continue;
        // Entiteterna kan skapas om vid ny runda – leta upp dem igen
        _ball = null;
        AddTimer(0.2f, FindEntities);
        AddTimer(0.5f, () => { SpawnBoards(); SetTeamScores(); });
        return HookResult.Continue;
    }

    [GameEventHandler]
    public HookResult OnMatchRestart(EventRoundAnnounceMatchStart e, GameEventInfo info)
    {
        _scoreCt = 0; _scoreT = 0; _goalLock = false;
        return HookResult.Continue;
    }

    // Felsökning: listar alla namngivna entiteter på banan (för att hitta resultattavlorna)
    [ConsoleCommand("css_fotboll_ents", "Listar namngivna entiteter på banan")]
    [RequiresPermissions("@css/root")]
    public void OnEnts(CCSPlayerController? caller, CounterStrikeSharp.API.Modules.Commands.CommandInfo cmd)
    {
        var lines = new List<string>();
        foreach (var e in Utilities.GetAllEntities())
        {
            var n = NameOf(e);
            if (string.IsNullOrEmpty(n)) continue;
            lines.Add($"{n} | {e.DesignerName}");
        }
        lines.Sort(StringComparer.OrdinalIgnoreCase);
        var file = Path.Combine(ModuleDirectory, "entiteter.txt");
        File.WriteAllLines(file, lines);
        cmd.ReplyToCommand($"{lines.Count} namngivna entiteter sparade i {file}");
    }

    [ConsoleCommand("css_fotboll", "Visar ställningen i fotboll")]
    [ConsoleCommand("css_score", "Visar ställningen i fotboll")]
    public void OnScore(CCSPlayerController? caller, CounterStrikeSharp.API.Modules.Commands.CommandInfo cmd)
    {
        if (!IsFootballMode()) { cmd.ReplyToCommand("Fotboll är inte igång."); return; }
        cmd.ReplyToCommand($" {ChatColors.Gold}⚽ Ställning:{ChatColors.Default}{ScoreLine()} (först till {Config.GoalsToWin})");
    }
}
