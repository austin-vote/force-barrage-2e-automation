# Force Barrage Automation

A Foundry VTT module for **Pathfinder 2e** that automates **Force Barrage** shard calculation, multi-target assignment, and damage rolling — for any cast source (spell, wand, scroll, staff, etc.).

When Force Barrage is cast, this module opens a dialog to assign shards to targets, then rolls the correct damage formulas and posts them to chat. The GM can apply directly via the module or leave PF2e's native apply-damage button on the chat card for manual use.

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

### Auto mode

1. Target one or more enemy tokens via Foundry's targeting tool (**T** key by default).
2. Cast Force Barrage from a character sheet, wand, scroll, or staff.
3. The module detects the cast and opens the Force Barrage dialog automatically.
4. Confirm the action count, spell rank, and optional flat bonus (e.g. Dangerous Sorcery).
5. Assign shards to each targeted token — the total must match.
6. Click **Roll Only** or **Roll & Apply**.

### Manual macro mode

Run the provided macro (see [Macro](#macro) below) at any time. Useful when Auto-Intercept is disabled or when casting from a custom item.

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

**Flat bonus** (e.g. Dangerous Sorcery, Sorcerous Potency): Applied **once per target**, not per shard. A +2 bonus with 3 shards to one target rolls `(3d4 + 5)[force]`.

---

## Roll Only vs Roll & Apply

| | Roll Only | Roll & Apply |
|---|---|---|
| Posts damage card | ✅ | ✅ |
| PF2e apply-damage button on card | ✅ — use it to apply | ❌ — omitted to prevent double-apply |
| Flavor badge | — | `(applied)` |
| Modifies HP immediately | ❌ | ✅ via `actor.applyDamage` |
| Works without targets | ✅ | ❌ — disabled |

**Roll Only** is the safer default. PF2e's native apply button on the chat card lets the GM inspect the roll before applying, and handles IWR (immunities, weaknesses, resistances) automatically.

**Roll & Apply** applies damage immediately using PF2e's `actor.applyDamage()` API — IWR-aware, no direct HP mutation. If the API is unavailable (PF2e version mismatch), the module warns and falls back to Roll Only behavior — it will **never** directly mutate `system.attributes.hp`.

---

## No-target behavior

If no tokens are targeted when the dialog opens:

- The dialog shows a clear **warning banner** — no misleading "All Targets" label.
- The **Roll & Apply** button is disabled. HP will never be touched without a resolved target token.
- **Roll Only** remains available for unresolved / untargeted damage cards.

---

## Detection — how it identifies casts

The module watches every incoming chat message and checks three layers in order:

1. **`flags.pf2e.origin`** — most reliable; set by PF2e for spells, wands, scrolls, and staves. Matches by exact slug.
2. **`flags.pf2e.casting` / `flags.pf2e.item`** — older PF2e format and some consumables. Matches by exact slug.
3. **Content fallback** — searches the rendered HTML for known spell names. Only fires when an actor speaker is present (prevents ambient GM chat from triggering the dialog).

Name matching is normalized (case, hyphens, whitespace) and uses exact or prefix matching — not substring — so `"Counter Force Barrage"` will never accidentally trigger the module.

---

## Settings

All settings are under **Settings → Module Settings → Force Barrage Automation**.

| Setting | Default | What it does |
|---|---|---|
| **Debug Logging** | Off | Turns on detailed console output (F12) for troubleshooting. |
| **Auto-Intercept Casts** | On | Automatically opens the dialog when a Force Barrage cast is detected in chat. Disable to use the manual macro only. |
| **Spell Slug Overrides** | *(empty)* | Override which item slugs the module matches. Comma-separated. Leave blank to use built-in defaults. |
| **Confirm Before Applying Damage** | Off | When using Roll & Apply, show a confirmation dialog before HP is modified. |

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
2. **Is Auto-Intercept on?** Check module settings.
3. **Does the slug match?** Enable Debug Logging, then cast the spell and check the browser console (F12) — it will show which layer was checked and what slug/name was found. If the slug doesn't match built-in defaults, paste it into **Spell Slug Overrides**.
4. **Are you the GM or the spell's caster?** The module only intercepts messages authored by the current user or the GM — it won't fire for a different player's cast on your client.

To inspect slugs manually with a token selected:
```js
_token.actor.items.filter(i => i.type === "spell").map(i => ({ name: i.name, slug: i.slug }))
```

### Roll & Apply isn't applying damage

1. Make sure at least one token is targeted before submitting — without a `tokenUuid`, `applyDamage` can't run.
2. Enable Debug Logging and check the console — it will say whether `applyDamage` was called and what it returned.
3. If you see `actor.applyDamage unavailable`, your PF2e version may not expose that method. Use Roll Only and apply via the chat card instead.

### Shard count looks wrong

The formula is `actions × (1 + floor((rank − 1) / 2))`. The dialog's shard summary line shows the full calculation. If the pre-filled rank is wrong (e.g. from a scroll cast at the base rank), adjust it manually in the dialog.

---

## Known limitations

1. **Rank pre-fill accuracy.** PF2e always provides `castRank` / `castLevel` for heightened casts; if those fields are absent (some older consumable formats), the module falls back to `rank` / `level` and logs a warning. The rank is always editable in the dialog.
2. **Flat bonus auto-detection.** The module reads `actor.synthetics.modifiers["spell-damage"]` for bonus values. If the bonus comes from a feat whose value isn't in synthetics (e.g. Dangerous Sorcery in some PF2e versions), the dialog pre-fills 0 and logs a hint — use the manual input field.
3. **PF2e version sensitivity.** The module reads PF2e-specific data structures. A major system update could change these. If the module stops working after an update, check the GitHub for a fix.

---

## License

MIT
