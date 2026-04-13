# Force Barrage Automation

A Foundry VTT module for **Pathfinder 2e** that automates **Force Barrage** shard calculation, multi-target assignment, and damage rolling — for any cast source (spell, wand, scroll, staff, etc.).

When Force Barrage is cast, this module opens a dialog to assign shards to targets, then rolls the correct damage formulas and posts them to chat. The GM applies damage using PF2e's native chat card buttons — the module never touches HP directly.

---

## Preview

![Force Barrage dialog and damage card](images/preview.png)

---

## Requirements

| Component | Version |
|---|---|
| **Foundry VTT** | v13 |
| **PF2e System** | 7.x |

---

## Installation

### Recommended: Install via Foundry module manager

1. Go to **Settings → Manage Modules** and click **Install Module**.
2. Paste this link into the "Manifest URL" field:
   ```
   https://raw.githubusercontent.com/austin-vote/force-barrage-2e-automation/main/module.json
   ```
3. Click **Install**.
4. Check **Force Barrage Automation** to enable it.
5. Restart Foundry or reload your world.

### Alternative: Manual install

1. Download or clone the repository:
   ```
   https://github.com/austin-vote/force-barrage-2e-automation
   ```
2. Place it in your Foundry `Data/modules/` folder (or create a junction/symlink pointing to it).
3. Make sure `module.json` is at the top level of the `force-barrage` folder.
4. Restart Foundry or reload your world.
5. Go to **Settings → Manage Modules** and check **Force Barrage Automation**.

---

## How to use it

1. Target one or more enemy tokens via Foundry's targeting tool (**T** key by default).
2. Cast Force Barrage from a character sheet, wand, scroll, or staff.
3. The module detects the cast and opens the Force Barrage dialog automatically.
4. Check the shard count (displayed prominently). Adjust actions or rank if needed.
5. If multiple targets, assign shards to each — the total must match.
6. Click **Roll**.
7. Apply damage from the chat card using PF2e's native buttons.

---

## Shard math

**Flat bonus** (e.g. Dangerous Sorcery): Detected automatically from the caster's PF2e data and applied **once per target**, not per shard. A +2 bonus with 3 shards to one target rolls `(3d4 + 5)[force]`. The dialog shows the detected bonus below the shard count.

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

## Troubleshooting

### The dialog never opens automatically

1. **Is the module enabled?** Check Settings → Manage Modules.
2. **Does the slug match?** Enable Debug Logging, then cast the spell and check the browser console (F12) — it will show which layer was checked and what slug/name was found.
3. **Are you the GM or the spell's caster?** The module only intercepts messages authored by the current user or the GM — it won't fire for a different player's cast on your client.

To inspect slugs manually with a token selected:
```js
_token.actor.items.filter(i => i.type === "spell").map(i => ({ name: i.name, slug: i.slug }))
```

## Known limitations

1. **Rank pre-fill accuracy.** PF2e provides `castRank` / `castLevel` for heightened casts; if those fields are absent (some older consumable formats), the module falls back to `rank` / `level` and logs a warning. The rank is always editable in the dialog.
2. **Flat bonus auto-detection.** The module first scans item rule elements for `FlatModifier` rules targeting `"spell-damage"` (best for rank-dependent bonuses like Dangerous Sorcery), then falls back to `actor.synthetics.modifiers["spell-damage"]` for code-injected modifiers. Rule element predicates are not evaluated — conditional bonuses are included regardless. If no bonus resolves, it defaults to 0.
3. **PF2e version sensitivity.** The module reads PF2e-specific data structures. A major system update could change these. If the module stops working after an update, check the GitHub for a fix.

---

## License

MIT
