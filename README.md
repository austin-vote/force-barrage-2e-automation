# Force Barrage Automation

A Foundry VTT module for **Pathfinder 2e** that automates **Force Barrage** shard calculation, multi-target assignment, and damage rolling — for any cast source (spell, wand, scroll, staff, etc.).

When Force Barrage is cast, this module opens a dialog to assign shards to targets, then rolls the correct damage formulas and posts them to chat. The GM applies damage using PF2e's native chat card buttons.

---

## Preview

<img width="1112" height="768" alt="image" src="https://github.com/user-attachments/assets/506cc303-3c7c-46a9-b682-c156c703a2e6" />
<img width="421" height="293" alt="image" src="https://github.com/user-attachments/assets/4fc8d1f6-ee0e-40d7-8f3c-6c7d92b1c0e1" />


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

## Settings

All settings are under **Settings → Module Settings → Force Barrage Automation**.

| Setting | Default | What it does |
|---|---|---|
| **Debug Logging** | Off | Turns on detailed console output (F12) for troubleshooting. |

---

## License

MIT
