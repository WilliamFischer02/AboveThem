// AboveThem.Exporter — BepInEx IL2CPP plugin stub (Phase 5).
// ALLOW-LIST EXPORTER. Read mod/README.md before adding any field.

using BepInEx;
using BepInEx.Unity.IL2CPP;

namespace AboveThem.Exporter
{
    [BepInPlugin(Id, "AboveThem Exporter", "0.1.0")]
    public class Plugin : BasePlugin
    {
        public const string Id = "co.goobentertainment.abovethem.exporter";

        public override void Load()
        {
            Log.LogInfo("AboveThem Exporter loaded. Listening on 127.0.0.1:47777 (TODO).");
            // TODO Phase 5:
            //  - Harmony patches on: chat received, meeting start/end, vote reveal (as displayed),
            //    exile text, sabotage start/end, local role/task assignment, roster changes.
            //  - Local WebSocket server; one JSON line per event.
            //  - NO patches that read other players' roles/positions. Ever.
        }
    }
}
