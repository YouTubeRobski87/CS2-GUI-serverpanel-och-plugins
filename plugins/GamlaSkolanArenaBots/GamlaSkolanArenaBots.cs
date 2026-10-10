using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes;
using CounterStrikeSharp.API.Modules.Timers;

namespace GamlaSkolanArenaBots;

// CS2-bottar tar fram kniven för att springa snabbare när de inte ser någon fiende.
// I 1v1 Arenas betyder det att de springer runt med kniv tills de möter dig.
// Det här pluginet tar ifrån bottarna kniven – men bara när K4-Arenas är igång och
// boten har ett riktigt vapen (knivrundor påverkas inte). Riktiga spelare rörs aldrig.
[MinimumApiVersion(375)]
public class GamlaSkolanArenaBotsPlugin : BasePlugin
{
    public override string ModuleName => "Gamla Skolan Arena Bots";
    public override string ModuleVersion => "1.0.0";
    public override string ModuleAuthor => "Gamla Skolan";
    public override string ModuleDescription => "Bots in 1v1 Arenas keep their gun out instead of running with the knife.";

    private bool _arenas;

    public override void Load(bool hotReload)
    {
        _arenas = ArenasActive();
        RegisterListener<Listeners.OnMapStart>(_ => _arenas = ArenasActive());
        AddTimer(0.5f, Check, TimerFlags.REPEAT);
    }

    private bool ArenasActive()
    {
        try { return Directory.Exists(Path.GetFullPath(Path.Combine(ModuleDirectory, "..", "K4-Arenas"))); }
        catch { return false; }
    }

    private static bool IsKnife(string n) => n.Contains("knife") || n == "weapon_bayonet";

    private static bool IsGun(string n) =>
        n.StartsWith("weapon_") && !IsKnife(n) && n != "weapon_c4" && n != "weapon_taser"
        && n is not ("weapon_hegrenade" or "weapon_flashbang" or "weapon_smokegrenade"
            or "weapon_molotov" or "weapon_incgrenade" or "weapon_decoy");

    private void Check()
    {
        if (!_arenas) return;
        foreach (var p in Utilities.GetPlayers())
        {
            try
            {
                if (p == null || !p.IsValid || !p.IsBot || !p.PawnIsAlive) continue;
                var pawn = p.PlayerPawn.Value;
                var ws = pawn?.WeaponServices;
                if (pawn == null || !pawn.IsValid || ws == null) continue;

                var weapons = ws.MyWeapons.Select(h => h.Value).Where(w => w != null && w.IsValid).ToList();
                if (!weapons.Any(w => IsGun(w!.DesignerName))) continue; // knivrunda – låt kniven vara

                foreach (var knife in weapons.Where(w => IsKnife(w!.DesignerName)).ToList())
                {
                    ws.ActiveWeapon.Raw = knife!.EntityHandle.Raw;
                    p.DropActiveWeapon();
                    var k = knife;
                    Server.NextFrame(() => { if (k.IsValid) k.Remove(); });
                }
            }
            catch { /* nästa bot */ }
        }
    }
}
