using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes;
using CounterStrikeSharp.API.Modules.Cvars;
using CounterStrikeSharp.API.Modules.Memory;
using CounterStrikeSharp.API.Modules.Memory.DynamicFunctions;

namespace GamlaSkolanFotboll;

// Fotbollsläget (CS2 Football, game_type 3): spelare och bottar tar ingen skada,
// så kniven bara sparkar bollen. Bollen själv tar skada som vanligt och kan sparkas.
// Gör ingenting i andra lägen.
[MinimumApiVersion(375)]
public class GamlaSkolanFotbollPlugin : BasePlugin
{
    public override string ModuleName => "Gamla Skolan Fotboll";
    public override string ModuleVersion => "1.0.0";
    public override string ModuleAuthor => "Gamla Skolan";
    public override string ModuleDescription => "Ingen skada på spelare i fotbollsläget";

    public override void Load(bool hotReload)
    {
        VirtualFunctions.CBaseEntity_TakeDamageOldFunc.Hook(OnTakeDamage, HookMode.Pre);
    }

    public override void Unload(bool hotReload)
    {
        VirtualFunctions.CBaseEntity_TakeDamageOldFunc.Unhook(OnTakeDamage, HookMode.Pre);
    }

    private static bool IsFootball()
    {
        var gt = ConVar.Find("game_type");
        return gt != null && gt.GetPrimitiveValue<int>() == 3;
    }

    private HookResult OnTakeDamage(DynamicHook hook)
    {
        if (!IsFootball()) return HookResult.Continue;
        var victim = hook.GetParam<CEntityInstance>(0);
        if (victim != null && victim.DesignerName == "player") return HookResult.Handled;
        return HookResult.Continue;
    }
}
