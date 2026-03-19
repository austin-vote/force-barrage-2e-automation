# Force Barrage Automation

A Foundry VTT module for **Pathfinder 2e** that automates **Force Barrage** shard calculation, multi-target assignment, and damage rolling — for any cast source (spell, wand, scroll, staff, etc.).

When Force Barrage is cast, this module opens a dialog to assign shards to targets, then rolls the correct damage formulas and posts them to chat. The GM applies damage using PF2e's native chat card buttons — the module never touches HP directly.

---

## Requirements

| Component | Version |
|---|---|
| **Foundry VTT** | v13 |
| **PF2e System** | 7.x |

---

## Installation

### Manual install

1. Download or clone the repository into your Foundry `Data/modules/` folder (or create a junction/symlink pointing to it).
2. Make sure `module.json` is at the top level of the `force-barrage` folder.
3. Restart Foundry or reload your world.

### Enable it

Go to **Settings → Manage Modules** and check **Force Barrage Automation**.

---

## How to use it

1. Target one or more enemy tokens via Foundry's targeting tool (**T** key by default).
2. Cast Force Barrage from a character sheet, wand, scroll, or staff.
3. The module detects the cast and opens the Force Barrage dialog automatically.
4. Check the shard count (displayed prominently). Adjust actions or rank if needed.
5. If multiple targets, assign shards to each — the total must match.
6. Click **Roll**.
7. Apply damage from the chat card using PF2e's native buttons.

You can also run the provided macro (see [Macro](#macro) below) at any time — useful when casting from a custom item.

---

## Shard math

Each shard deals **1d4 + 1 force** damage. The number of shards scales with action cost and spell rank:

```
shards = actions × (1 + floor((rank − 1) / 2))
```

| Rank | 1 Action | 2 Actions | 3 Actions |
|------|----------|-----------|-----------|
| 1 | 1 | 2 | 3 |
| 3 | 2 | 4 | 6 |
| 5 | 3 | 6 | 9 |
| 7 | 4 | 8 | 12 |
| 9 | 5 | 10 | 15 |

**Multi-target:** Shards are split freely across targets. Each target's shards are combined into one roll — for example, 3 shards to one target rolls `(3d4 + 3)[force]`.

**Flat bonus** (e.g. Dangerous Sorcery): Detected automatically from the caster's PF2e data and applied **once per target**, not per shard. A +2 bonus with 3 shards to one target rolls `(3d4 + 5)[force]`. The dialog shows the detected bonus below the shard count.

---

## No-target behavior

If no tokens are targeted when the dialog opens:

- A small inline note appears: "No targets — roll will have no apply buttons."
- Rolling still works — you just won't get PF2e's apply-damage buttons on the chat card.
- The module **never** touches HP directly. All damage application goes through PF2e's native chat card buttons.

---

## Chat output

Each target gets a single chat card containing:
- A flavor header: **Force Barrage** — Rank X, Y actions
- The target name and shard count
- The rolled damage formula
- PF2e's native Apply Damage buttons (when a target token was selected)

No separate summary card. No spam.

---

## Detection — how it identifies casts

The module watches every incoming chat message and checks three layers in order:

1. **`flags.pf2e.origin`** — most reliable; set by PF2e for spells, wands, scrolls, and staves. Matches by exact slug.
2. **`flags.pf2e.casting.embeddedSpell`** — scroll/wand/staff consumable casts embed the full spell object here. Matches by exact slug or normalized name.
3. **Content fallback** — searches the rendered HTML for known spell names. Only fires when an actor speaker is present (prevents ambient GM chat from triggering the dialog).

Name matching is normalized (case, hyphens, whitespace) and uses exact or prefix matching — not substring — so `"Counter Force Barrage"` will never accidentally trigger the module.

---

## Settings

All settings are under **Settings → Module Settings → Force Barrage Automation**.

| Setting | Default | What it does |
|---|---|---|
| **Debug Logging** | Off | Turns on detailed console output (F12) for troubleshooting. |

---

## Macro

Create a **Script** macro in Foundry and paste this in:

```js
const mod = game.modules.get("force-barrage");

if (!mod?.active) {
  ui.notifications.error(
    "Force Barrage module is not active. Enable it in Settings → Manage Modules.",
  );
} else if (typeof mod.api?.openDialog !== "function") {
  ui.notifications.error(
    "Force Barrage API not found — try reloading Foundry (F5).",
  );
} else {
  mod.api.openDialog();
}
```

**Usage:**
1. Select (control-click) your caster's token.
2. Target enemy tokens with the targeting tool.
3. Run the macro.

The dialog opens with the caster pre-filled and current targets loaded. Also saved at [`macros/force-barrage.js`](macros/force-barrage.js).

---

## Troubleshooting

### The dialog never opens automatically

1. **Is the module enabled?** Check Settings → Manage Modules.
2. **Does the slug match?** Enable Debug Logging, then cast the spell and check the browser console (F12) — it will show which layer was checked and what slug/name was found.
3. **Are you the GM or the spell's caster?** The module only intercepts messages authored by the current user or the GM — it won't fire for a different player's cast on your client.

To inspect slugs manually with a token selected:
```js
_token.actor.items.filter(i => i.type === "spell").map(i => ({ name: i.name, slug: i.slug }))
```

### Shard count looks wrong

The formula is `actions × (1 + floor((rank − 1) / 2))`. The dialog shows the total prominently. If the pre-filled rank is wrong (e.g. from a scroll cast at base rank), adjust it manually in the dialog.

---

## Known limitations

1. **Rank pre-fill accuracy.** PF2e provides `castRank` / `castLevel` for heightened casts; if those fields are absent (some older consumable formats), the module falls back to `rank` / `level` and logs a warning. The rank is always editable in the dialog.
2. **Flat bonus auto-detection.** The module first scans item rule elements for `FlatModifier` rules targeting `"spell-damage"` (best for rank-dependent bonuses like Dangerous Sorcery), then falls back to `actor.synthetics.modifiers["spell-damage"]` for code-injected modifiers. Rule element predicates are not evaluated — conditional bonuses are included regardless. If no bonus resolves, it defaults to 0.
3. **PF2e version sensitivity.** The module reads PF2e-specific data structures. A major system update could change these. If the module stops working after an update, check the GitHub for a fix.

---

## License

MIT
