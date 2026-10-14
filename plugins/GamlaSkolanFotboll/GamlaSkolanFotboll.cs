using System.Text.Json.Serialization;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes;
using CounterStrikeSharp.API.Core.Attributes.Registration;
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
    public override string ModuleVersion => "1.1.0";
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

    public override void Load(bool hotReload)
    {
        RegisterListener<Listeners.OnEntityTakeDamagePre>((victim, info) =>
            IsFootballMode() && victim != null && victim.DesignerName == "player" ? HookResult.Handled : HookResult.Continue);
        HookEntityOutput("*", "OnStartTouch", OnStartTouch, HookMode.Post);
        RegisterListener<Listeners.OnMapStart>(_ => ResetMatch(clearBallStart: true));
        AddTimer(0.1f, Tick, TimerFlags.REPEAT);
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

        Server.PrintToChatAll($" {ChatColors.Gold}⚽ MÅL!{ChatColors.Default} {text}");
        Server.PrintToChatAll(ScoreLine());
        var centerWho = who == null ? Team(scoring) : who.PlayerName;
        foreach (var p in Utilities.GetPlayers().Where(p => p is { IsValid: true, IsBot: false }))
            p.PrintToCenterHtml($"<font color='#f5c542' class='fontSize-xl'>⚽ MÅL!</font><br>{System.Net.WebUtility.HtmlEncode(centerWho)}<br><font color='#5fa8ff'>CT {_scoreCt}</font> – <font color='#ffd34d'>{_scoreT} T</font>", 4);
        Logger.LogInformation("Mål för {Team} ({Who}), CT {Ct} – T {T}", Team(scoring), who?.PlayerName ?? "-", _scoreCt, _scoreT);

        if (_scoreCt >= Config.GoalsToWin || _scoreT >= Config.GoalsToWin)
        {
            var winner = _scoreCt >= Config.GoalsToWin ? CsTeam.CounterTerrorist : CsTeam.Terrorist;
            AddTimer(2f, () =>
            {
                Server.PrintToChatAll($" {ChatColors.Gold}🏆 {TeamColor(winner)}{Team(winner)}{ChatColors.Gold} vinner matchen!{ChatColors.Default}{ScoreLine()}");
                foreach (var p in Utilities.GetPlayers().Where(p => p is { IsValid: true, IsBot: false }))
                    p.PrintToCenterHtml($"<font color='#f5c542' class='fontSize-xl'>🏆 {Team(winner)} VINNER!</font><br><font color='#5fa8ff'>CT {_scoreCt}</font> – <font color='#ffd34d'>{_scoreT} T</font><br>Ny match börjar strax", 6);
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
        return HookResult.Continue;
    }

    [GameEventHandler]
    public HookResult OnMatchRestart(EventRoundAnnounceMatchStart e, GameEventInfo info)
    {
        _scoreCt = 0; _scoreT = 0; _goalLock = false;
        return HookResult.Continue;
    }

    [ConsoleCommand("css_fotboll", "Visar ställningen i fotboll")]
    [ConsoleCommand("css_score", "Visar ställningen i fotboll")]
    public void OnScore(CCSPlayerController? caller, CounterStrikeSharp.API.Modules.Commands.CommandInfo cmd)
    {
        if (!IsFootballMode()) { cmd.ReplyToCommand("Fotboll är inte igång."); return; }
        cmd.ReplyToCommand($" {ChatColors.Gold}⚽ Ställning:{ChatColors.Default}{ScoreLine()} (först till {Config.GoalsToWin})");
    }
}
