# Mech Battle Toy

A browser toy where factions of little low-poly mechs fight a procedurally
generated battle on a tilt-shifted isometric diorama, either forever or until
one side (or team) is wiped out.

## Running

```sh
npm install
npm run dev      # local dev server with hot reload
npm test         # unit tests (headless, no browser needed)
npm run build    # typecheck + production build into dist/
npm run sims     # balance runs: play many battles headlessly, print stats
```

### Balance runs

`npm run sims` plays a representative set of battles (1v1 on each map size,
without outposts, with attacks on the tide, 2v2, 1v3, free-for-alls of 3, 4
and 6 sides, and a stretch of Eternal) at full speed with no rendering,
several at once, and prints a table per scenario: battle length (median,
mean, range), wins per team, and per-battle kills, buildings razed,
outposts taken and attacks launched. `--quick` runs about a third as many,
`--only 1v1,2v2` picks scenarios, `--battles N` and `--workers N` override
the counts, and `--list` shows the scenarios. `--set "sgrow=none&scap=2"`
changes settings for every battle (written as in the page URL), so running
the same scenarios with each option of a setting compares them on the same
battles. Every side plays Armour, so plain runs compare settings in mirror
matches. `--doctrines` gives each battle's sides doctrines from an
orthogonal array (every pair of doctrines meets equally often in each
pair of slots, without playing every combination; see `orthogonalArray`)
and adds a table of win rates per doctrine and head to head. The array
needs a prime power number of doctrines (2, 3, 4, 5, 7, 8, 9...). Win
rates come with a 95% margin of error (`56% ±12`): two doctrines inside
each other's margins may well be even. "vs par" scores wins against a fair
share (one over the number of teams), so 1.00x is even in any team setup.

With `--doctrines` (or `--units` on its own) it also prints a unit report
per doctrine: for each unit type, how many were built and lost, kills and
buildings razed, damage done and taken per unit (after armour, overkill not
counted), damage and kills per minute of cap slot spent on it, how much of
its time on the field it spent firing, where its damage went (infantry,
vehicles, air, super units, buildings), and which enemy types it killed
most and died to most (outpost garrisons show as e.g. "outpost tower").
Kills alone overrate weapons that mow down infantry; damage and the per
cap-slot numbers show what a unit is worth for the room it takes up, and a
low firing share points at units that idle. It's saved as `-units.csv`
next to the other results.

`--maps wet,dry,hilly` plays on several map types (`medium`, `wet`, `dry`,
`hilly`, `rugged`, `small`, `large`, `notown`, or your own as
`name:settings`, e.g. `flat:hills=0`) and splits the win rates by map type.
With `--doctrines` the map type is one more column of the orthogonal array,
so every doctrine meets every map type equally often in the same 64
battles; `--every-map` plays every battle on every map type instead, for
tighter numbers per map at that many times the cost.

`--compare a.json b.json` compares two saved runs without playing anything:
battle lengths, doctrine win rates (flagging changes bigger than the
noise), how many of the same battles changed winner, and the units whose
damage per cap slot moved most. Run the same command before and after a
change and compare the two.

`--duel "tank*4 vs trooper*12"` skips battles and sets two groups on each
other on open ground, with no bases or reinforcements, over `--rounds`
(default 20) different maps, and prints who won, how fast and with how
much health left. Line-ups mix with `+` (`lancer+trooper*6`), several duels
go in one run separated by `;`, `--gap` sets the starting distance and
`--set` changes settings as usual (e.g. `tank=1.2,1,1,1` for tanks with
1.2× health). Duels take seconds and have no tide, AI timing or map
luck in them, so they answer "does this unit beat that one" much more
cheaply than battles. The code is in `src/sim/duel.ts`.

Every battle is saved to
`sims-results/` (JSON and CSV) with a link that replays it in the browser:
each battle's seed is named after its scenario and number (`1v1-7`), so the
same battle plays out the same way on any machine. The scenarios live in
`src/sim/simulate.ts`; PRs that change the balance add to them and say which
to run.

The page opens on a **setup screen** over a battle that's already running.
Pick a mode, map size, water and hills, army pacing, per-unit stat
multipliers and the sides (two to eight, each with a name, colour and team),
then start. Each side also picks a **doctrine** (see below). Setup sections fold away; the page remembers which are open. Everything you change
is written to the page URL, so a link reproduces a setup (and, during a
battle, its exact map via `seed`).

- **Eternal:** ruined buildings are rebuilt and the war never ends.
- **Attacks:** *When ready* (default) has each side mass until its army can
  break the enemy base, attack, and fall back to regroup once the attack is
  spent; *On the tide* attacks on the tide's clock instead. The HUD shows
  what each side is doing (massing and how ready, attacking whom,
  regrouping, defending).
- **Tide ramp** and **siege ramp** (both modes, their own values for each):
  how fast a battle escalates. On by default in Conquest so long battles
  build to a finish, off by default in Eternal (both off gives the steadier,
  longer battles). They can also be changed mid-battle from the Battle
  controls panel.
- **Unit stats** take multipliers in steps of 0.05, and show what each stat
  works out to (HP, damage per second, speed, range) under its box.
- **Sides and teams:** every side picks a team. All on different teams is a
  free-for-all; any split works (2v2, 1v3, 3v3v2...). Allies don't shoot
  each other, attack the same enemy together, start next to each other (unless
  the base layout spreads them out) and
  come to help when a teammate's base is attacked. "Team boost" evens out
  uneven teams: sides on smaller teams get more production and a bigger
  unit cap, (largest team ÷ their team) to the power of the setting. The
  default, 0.85, gives one side against three about 2.5 times as much,
  which came out roughly even in 1v3; uneven battles are never quite fair,
  so it's a slider. More sides
  make a bigger map.
- **Map:** size and **shape** (wider or deeper, keeping the area), a
  **biome** (temperate, desert, snow or forest: the ground's colours, the
  trees and rocks, the water and sky, and the style towns are built in;
  looks only, nothing moves differently), where the **bases** go (round the
  edge with allies side by side, round the edge with allies spread out, or
  teams in two lines facing each other), water and hills, and how many
  **towns** (none to four) and how big. Towns have districts: a harbour of
  warehouses on the waterfront, an industrial quarter, taller blocks in the
  centre, houses round them, and a paved main street. **Waterways** (on by
  default) dig channels joining the water near the bases, so boats can
  sail from one to another; from 60% water every base gets water, with an
  inlet dug to any that has none. Wherever water cuts the land, an
  indestructible **bridge**, wide enough for the biggest walkers, carries
  land units over while boats pass underneath.
- **Doctrines:** what kind of army a side fields, picked freely per side
  (each faction slot has a default: Cobalt Armour, Crimson Raiders, Ashen
  Legion, Gilded Bastion, Violet Talon, Ivory Skyline, Teal Tidewater,
  Ember Firestorm). Every doctrine fields rifle squads with AT troopers,
  the Scout Copter and a heavy unit.
  - *Armour:* tanks, striders and flak tanks from the factory, the Lancer
    heavy tank from its **tank depot**, fewer infantry (0.8× cap) and more
    vehicles (1.4×). The flak tank's scattered bursts catch a soldier or
    two rather than a whole squad, and bring down aircraft. Super unit:
    the Titan.
  - *Raiders:* machine-gun trucks and scout buggies in numbers from the
    factory and a **motor pool**, rocket trucks (light artillery that also
    shells buildings) for the heavy work; 1.8× vehicle cap, 0.8× infantry.
    Super unit: the Land-train, an armoured rocket battery on tracks.
  - *Legion:* big squads with two AT troopers each and mortar teams from
    the barracks and a **barracks block**, light tanks and squad carriers
    from the factory; 1.7× infantry cap, 0.8× vehicles. Super unit: the
    Siege Crawler, slow heavy mortars that drops off a squad every 40
    seconds.
  - *Skyline:* gunships, bombers and scout copters from its **airpad**,
    battle tanks and flak walkers from the factory; 2.5× air cap, 0.8×
    infantry and vehicles. Super unit: the Airship Carrier, a slow
    armoured airship that launches drones.
  - *Bastion:* howitzers (its signature unit), railgun batteries (long,
    flat, armour-piercing shots), battle tanks and flak tanks, a **sensor
    mast** and two extra guard towers; 1.1× vehicles. Howitzers and
    railguns shoot further than their crews can see; inside the mast's
    30-unit radius, or the Fortress Walker's 26, they fire at their full
    range. Super unit: the Fortress Walker.
  - *Talon:* packs of three striders, spider walkers (which take any slope
    as easily as flat ground and fit down town streets, and shoot at
    aircraft) and Warhound heavy walkers from the factory and a **mech
    forge**; 1.05× vehicles, 0.8× infantry. Super unit: the Juggernaut.
  - *Tidewater:* skimmer hover tanks, amphibious transports (which carry a
    squad) and battle tanks from the factory; 1.35× vehicles, 0.8×
    infantry. A **dock** on the nearest shore launches missile boats, if
    there's open water within reach of the base (on the default maps
    there usually isn't; from 0.6 water up, waterways give every base some).
    Boats don't count against the vehicle cap: a side has six berths
    (times its team boost), and a dock with them all full builds
    skimmers.
    Without a coast it gets a **hover pad** that turns out skimmers
    instead, and it's the weaker for it. Boats can't take outposts or
    follow the land lanes: they head for the enemy base and stop at the
    nearest water to it. Super unit: the Hover Fortress.
  - *Firestorm:* flame troopers in the squads, cinder walkers, light
    tanks and scorch buggies from the factory, and more buggies from a
    **fuel depot**, which blows up when destroyed, hurting everything
    round it; 1.25× infantry, 1.2× vehicles. Flame is short-ranged and
    splashes, and isn't stopped by cover: it licks round corners, so it's
    best for clearing towns. Super unit: the Inferno Walker.
  **Carriers** (`systems/carriers.ts`) bring a squad with them and drop it
  off when an enemy they're after is close or they reach their objective;
  the squad then fights (and is refilled in territory) like any other, and
  the carrier loads up again a minute later (the Airship Carrier works the
  same way with drones). Each doctrine's
  units, caps, buildings and Eternal fallback waves are data in
  `game/doctrines.ts`.
- **Aircraft** fly over terrain, buildings and ground units, and circle
  whatever they're fighting rather than parking over it. Only weapons
  made for it reach them: AT troopers' missiles, MG trucks, flak, towers,
  striders, Titans and other aircraft. Explosions reach as far up as they
  do sideways, so a shell bursting on the ground doesn't touch an aircraft
  overhead. Shot-down aircraft fall out of the sky.
- **Unit caps:** each side has a cap per category: infantry, vehicles,
  aircraft and super units (the Titan and the other doctrines' super units), leaned by
  the side's doctrine. A full category stops its own production but not
  the others. Super units are rare: a small cap (1 by default) and a slow
  mech bay. The super cap can grow during a battle, with the tide ramp (up
  to 3× when the ramp tops out; the default) or by one for each outpost
  held past the first, or stay fixed. An option (off by default) only lets
  a side build them while it holds an outpost; it's off because the first
  side to attack tends to take the outposts and with them every Titan.
- **Outposts:** small capturable forts in no-man's land (see below). Pick
  how many (Auto is one per side), how strong their bonuses are, and how many
  squads hold them between attacks (off by default).
- **Conquest:** no rebuilding. A side is knocked out when its HQ and every
  production building are destroyed, and the battle ends when only one team
  is left standing; after a victory banner with a summary of the
  battle (units fielded and lost, kills, buildings razed, each side's top
  unit) a fresh map starts with the same settings. "Set up after this battle" goes to the setup
  screen instead, and "End battle and set up" goes there right away.

**Controls:** WASD / arrows or right-drag to pan, wheel to zoom, Q / E to
rotate, F follows the fighting, T toggles tilt-shift, space pauses, 1-4 set
speed, Esc cancels.

The **Battle controls** panel (top right) sets speed and camera effects.
**Follow the fighting** turns the camera into a spectator that glides to
wherever the biggest fight is (panning by hand turns it off). **Shadows**
High / Low / Off trades looks for speed in huge battles; shadows are only
drawn around the part of the map in view either way. Both are remembered
in this browser rather than in the battle link. Pick a
side to drop units anywhere on the map, place a rally flag, and override the
AI with Attack / Hold (Auto follows the ebb and flow of the battle). Click any
unit or building to inspect it.

## Architecture

The simulation and the renderer are separate. The game can run headless
(the tests do this), and the renderer only reads game state.

```
src/
  core/      engine-agnostic building blocks
    ecs.ts       World, entities, components, systems
    loop.ts      fixed-timestep sim loop with render interpolation
    rng.ts       seeded RNG; everything procedural draws from it
    events.ts    typed event bus for cross-system signals
    spatialGrid.ts   uniform grid for neighbour queries
  world/     battlefield data (no rendering)
    battlefield.ts   heightmap generation, heightAt/isWater/slopeAt, base sites; the ground layer,
                     bridges, and changing the map mid-battle (paint, reshape, onChange)
    ground.ts        kinds of ground (plain, road, scrap, dense forest) and what they cost each movement class
    waterways.ts     channels joining the bases' water, and bridges wherever water cuts the land
    biomes.ts        biomes: colours, scenery mix and town style
    props.ts         scenery placement (the biome's trees, cacti, rocks...)
    settlements.ts   base and town layouts (building placements as data)
    moveClasses.ts   movement classes (foot, tracked, walker, climber, hover, amphibious, naval, air) and their terrain rules
    navGrid.ts       route-planning grid per movement class (terrain, slopes, towns, buildings) and A*
  game/      simulation
    components.ts    component definitions (Transform, Mover, Armed, ...)
    units.ts         unit and weapon definitions (stats are data)
    buildings.ts     building definitions: production, defences, civic
    spawn.ts         assembles unit and building entities from definitions
    tide.ts          production tide, the tide's attack clock, and the ramps
    offensive.ts     when each team attacks: readiness, or the tide's clock
    lanes.ts         attack routes (centre, and through outposts and towns) and which squad takes which
    outposts.ts      capturable outposts: garrisons, capturing, bonuses
    caps.ts          unit caps per category, and when super units can be built
    territory.ts     territory (bases and held outposts), healing and squad refills there
    orders.ts        per-faction player orders (stance, rally point)
    context.ts       shared services and the game event types
    factions.ts      default faction names and colours
    settings.ts      BattleSettings: everything the setup screen tunes, and what it derives
    systems/         one file per system (ai, movement, weapons, ...)
    game.ts          wires world + battlefield + systems together
  render/    Three.js view
    stage.ts         renderer, scene, lights, post-processing; load(game) swaps battles
    dispose.ts       frees a battle's GPU resources (shared model caches are kept)
    cameraRig.ts     isometric orthographic camera and controls
    fightWatch.ts    finds the fighting (from sim events) for the spectator camera
    tiltShift.ts     tilt-shift blur + colour grade passes
    terrainMesh.ts   low-poly ground, soil skirt, water and bridges; redraws cells the map changes
    propsMesh.ts     instanced scenery
    models.ts        model registry and rig (turret / animation hooks)
    models/          unit, building and projectile models
    entityView.ts    mirrors ECS entities into the scene each frame
    effects.ts       particles for flashes, explosions, smoke, debris
    markers.ts       rally flags and the selection ring
    outpostRings.ts  capture rings round outposts, filling as a side takes one
  ui/
    controls.ts      in-battle panel and map clicks; changes the sim only via Game commands
    setupScreen.ts   pre-battle settings screen
    settingsUrl.ts   settings <-> URL query string (only non-default values)
    viewPrefs.ts     display preferences (shadows, follow) kept in this browser
    dom.ts           small DOM helpers
  sim/
    simulate.ts      headless balance scenarios and stats (npm run sims; scripts/sims.mjs runs them)
    duel.ts          unit-against-unit duels on open ground (npm run sims -- --duel)
  app.ts     session flow: one renderer and loop, a battle at a time, setup in between
```

### Changing the map mid-battle

The map isn't fixed once generated. `Battlefield.paint(x, z, radius,
ground)` lays a kind of ground over an area (scrap where wrecks pile up, a
road), `reshape(x, z, radius, fn)` changes heights (a canal, a wall's
footing) and `addBridge` adds a bridge. Each tells everything listening
through `onChange` which cells changed: the route grids recompute those
cells and their connected regions and bump their version (so routes
re-plan, as they do when buildings go up or down), and the terrain mesh
redraws them. Nothing in the battle uses this yet; it's there for scrap
piles, dense forest with trees that can be knocked down, walls, canals,
and towns that engineers grow. Lanes, outposts and the scenery are still
placed once, at the start.

### Conventions

- **Data in components, logic in systems.** New behaviour is a new component
  plus a system, registered in `game.ts` in the right order.
- **Determinism.** The sim runs at a fixed 30 Hz and only uses `Rng`
  streams forked from the map seed. Don't use `Math.random()` in `game/` or
  `world/`.
- **Coordinates.** x is the long axis, z across, y up. Heading 0 faces +x;
  models are built facing +x. Bases sit round the edge of the map in
  "seats" (`seatPoint` in `world/battlefield.ts`), starting on the west side;
  with two sides, faction 0 is on -x and faction 1 on +x.
- **Adding a unit.** Add an entry to `UNIT_DEFS` in `game/units.ts` (with a
  movement class and a role, below), register
  a model under its `model` key (see `render/models/units.ts`), and add it to
  the wave table in `game/systems/reinforcements.ts`.
- **Adding a building.** Add an entry to `BUILDING_DEFS` in
  `game/buildings.ts` (give it `production` to make units, or `weapon` to
  defend), register a model, and place it in `world/settlements.ts`.
- **Movement.** AI only sets `Mover.targetX/Z` (and `faceX/Z` for where to
  look when idle). The movement system goes straight when the line is clear,
  otherwise plans an A* route on the nav grid, steers around obstacles in
  the way, and sidesteps if it stops making progress. Routes respect the
  unit's radius: the nav grid keeps a clearance map, so a Titan only plans
  through gaps it fits. Spawning (`spawnSpot` in `systems/production.ts`)
  also checks there's room, and base layouts keep an apron clear in front of
  production doors.
- **Movement classes** (`world/moveClasses.ts`). Every unit has one, and
  plans on that class's nav grid (`ctx.navs.for(move)`; all grids share the
  building obstacles, and `ctx.nav` is the tracked-vehicle grid used for
  lanes and spawn spots). A class says how deep water it can enter
  (walkers wade shallows, hovers and amphibious units cross any water,
  boats stay in it), whether it can climb steep ground, and what slopes,
  water and towns cost it. Infantry find towns and outposts cheap, tanks
  and mechs find them dear, and walkers take slopes easily. A straight line
  to the goal is only taken if it keeps to plain ground, and route
  smoothing never shortcuts across ground the route went round, so the
  costs show up as routes. A goal a class can't get to at all (a boat
  sent inland, or across a lake with no way round) becomes the nearest spot it can
  reach (`NavGrid.nearestInRegion`). The **ground layer** (`world/ground.ts`)
  adds a cost and a speed per class on top: roads are a little quicker for
  wheels and tracks, scrap is a slog for tanks and hovers but easy for long
  legs, dense forest slows vehicles. Bridge decks count as dry, level ground
  for every class but boats, which see the water underneath. Aircraft fly straight at `altitude`, only bump
  into other aircraft, and can only be shot by weapons whose `targets` is
  `air` or `both`.
- **Line of fire** (`game/lineOfFire.ts`). Direct-fire shots (bullets and
  shells, `arc: false`) are traced when fired and stop at the first
  building, rise in the ground or enemy unit in their way; a miss carries on
  past the target until it hits something or comes down. Allied units are
  see-through; allied buildings stop shots but take no damage. Targeting
  prefers enemies it has a clear shot at, a weapon holds fire while a
  building or the ground is in the way (`Armed.blocked`), and the AI moves
  the unit to a nearby spot with a clear shot (`Armed.spotX/Z`, from
  `firingSpot` in `systems/targeting.ts`). Lobbed weapons fly over
  everything, and flame licks round whatever's in the way. Buildings have a `height` for this, units use
  `unitHeight`. Infantry keep a little extra space between each other so
  splash catches fewer of them.
- **Roles** (`Role` in `game/units.ts`). *Frontline* units lead and close
  in. *Artillery* fires from near its longest range and backs away
  from enemies inside its minimum range. *Support* (no units yet) follows a little behind the
  nearest frontline ally and doesn't chase. Weapons reach up to 15%
  further from high ground (`effectiveRange` in `systems/targeting.ts`).
- **Armour** is a flat amount taken off every hit, down to a tenth of
  the hit (`damageThrough` in `systems/projectiles.ts`). Rifles barely
  scratch tanks and buildings; AT rockets get through a tank's armour but
  not much of a Titan's. Targeting counts a target the weapon is wasted on
  as further away (`hitWorth` in `systems/targeting.ts`), so rifles shoot
  infantry and rockets go for vehicles.
- **Territory** (`game/territory.ts`): a side's base and the ground round
  each outpost it or an ally holds. A unit that hasn't fired or been hit
  for 10 seconds heals there, and infantry squads (recorded by
  `recordSquad` when raised) get missing soldiers back one at a time,
  appearing beside the squad.
- **Unit caps** (`game/caps.ts`). Every unit has a `category` (infantry,
  vehicle, super) and counts against that cap; ask `canBuild` before
  producing one, which also checks the super unit's outpost gate (if on). Caps are
  scaled by side strength like production. Outpost guards don't count.
- **Settings.** Tuning the player can change lives in `BattleSettings`
  (`game/settings.ts`). Systems read it from `ctx.settings` every tick, and
  use `ctx.units` / `ctx.buildings` (the definitions with multipliers
  applied) rather than `UNIT_DEFS` / `BUILDING_DEFS` directly. To add a
  setting: add it to the type and `defaultSettings()`, give it a range in
  `LIMITS`, a URL key in `ui/settingsUrl.ts` and a control in
  `ui/setupScreen.ts`.
- **Sides.** Any number of factions, each on a team. Never compare faction
  ids to decide who fights: ask `ctx.sides` (`game/sides.ts`), which owns
  `hostile` / `allied`, which enemy a team attacks, tide phases and who has
  been knocked out. Per-side arrays are sized by `ctx.sides.count`, and
  `field.baseSites[f]` is side f's base. `NEUTRAL` (-1) is the civilian
  town: nobody targets it, but splash damage hurts it.
- **Adding a model.** Call `registerModel('key', faction => object3d)` and
  give entities `Renderable { model: 'key' }`. Use `setRig` to expose a
  `turret` (aimed automatically from the `Armed` component) or an `animate`
  hook (walk cycles etc.).
  `test/models.test.ts` builds every model and fails if two parts have
  faces in the same plane (z-fighting); make trim a touch larger or smaller
  than the part it sits on rather than flush.
- **Effects** listen to game events (`fired`, `impact`, `unitDestroyed`) and
  never touch the simulation.
- **Transforms** keep previous-tick values (`px`, `py`, ...) so rendering can
  interpolate between sim steps. The snapshot system must stay first.

## How the battle keeps going

- Each base has an HQ, barracks, vehicle factory and mech bay that produce
  units on timers, plus its doctrine's signature building and guard
  towers. What each building turns out depends on the doctrine. Infantry come in squads of riflemen
  with an AT trooper. Squads march huddled together and open out once
  they have something to shoot at, have fired or have been hit (for six
  seconds after), so a big infantry army fits on its rally ground but one
  shell still doesn't catch a whole squad in a fight. A civilian town sits in no-man's land.
- **When to attack** (`game/offensive.ts`). With the default *readiness*
  timing, each team masses at home until it fields at least 70% of its unit
  cap and its army outweighs the defence at the enemy base (units and
  towers there, by `fightingStrength`: the square root of toughness times
  damage per second) by a margin. The margin starts at 1.6× and falls to
  0.8× over 150 seconds of waiting, so evenly matched sides don't stall.
  A team whose bases are all under attack stays home to fight first. An
  attack is spent once the units that set out are down to 45% (units built
  meanwhile still join in), when its target is knocked out, or after two
  minutes; the army falls back and regroups for 45 seconds before the next.
  Without the regroup pause and staying home under attack, both armies set
  out for each other's empty bases and battles were a third shorter. The
  timings stretch on bigger maps. With *tide* timing, attacks follow the
  tide's clock instead.
- The **tide** (`game/tide.ts`) swings each side's production up and down,
  surging for one team while the others ebb. Teams are spread evenly round
  the cycle and allies share a phase. Which team surges first is rolled per
  map, and the swing fades in over the first cycle so going first isn't
  decisive. With tide timing, a side attacks while it surges.
- Each attack, a team picks one enemy side to go after (`Sides.target`),
  nearer enemies more often. New units form up in front of their own base,
  toward the enemy they'll attack next.
- **Defence** (`defenceSystem` in `game/sides.ts`) counts the enemy units
  at each base once a second. Holding units go to meet a raid on whichever
  side of the base it comes from, or help an ally whose base is under
  attack. If raiders outnumber the defenders, the side calls off its attack
  and the army comes home until clearly enough defenders are back (the
  player's attack order overrides this). In Eternal
  mode a mild rubber band helps a badly outnumbered side; Conquest lets an
  advantage snowball so battles end. The tide's cycle stretches on maps
  longer than medium, so attacks have time to cross the map.
- The **ramps** escalate a battle over time (`escalate` in `game/tide.ts`):
  the tide ramp makes the tide swing harder, starving the defending side,
  and the siege ramp makes hits on buildings do more damage, so a won field
  turns into a won battle. Overall
  production deliberately doesn't grow: more units for both sides favours
  the defender, whose reinforcements roll straight out of the door (measured:
  it made Conquest battles longer). With the default ramps, Conquest runs
  about 5 to 13 minutes on a medium map (now and then 15) and 8 to 14 on a
  large one.
- **Battle stats** (`game/stats.ts`) keep score from events only. Every hit
  records who landed it (`Health.lastHit`), and the death events carry that
  as `killer`, so kills are credited to the unit or building type that
  landed the last blow.
- Attacks follow **lanes** (`game/lanes.ts`): one straight from base to base,
  and one through each outpost or town that lies roughly between the two
  (where nothing does on one side of that line, a lane swings wide on that
  side instead), worked out for each
  pair of bases that actually fight. Units built together form a squad and
  share a lane. Each attack a side favours one of the side lanes, and the
  Flanking setting decides how many squads leave the centre, so fights
  break out all over the map rather than along one front line.
- **Outposts** (`game/outposts.ts`) are small forts in no-man's land:
  a post, two towers and a bunker that keeps four guards about (but can't
  send new ones out while enemies are in the ring). Each starts
  held by its own garrison (faction `GARRISON`), which fights every side and
  wears the colours of a faction not in the battle. A side takes one by
  having units inside the ring with no defenders there; more units take it
  faster, and two attacking teams at once stall each other. The towers and
  bunker then switch sides. Holding one gives a bonus (`OutpostBonus`,
  for now always faster production; the Outposts bonus setting scales it)
  and makes the ground round it the holder's territory (see below). A production bonus adds the same to
  every side (+10% of a normal side's rate), so a side boosted for uneven
  teams doesn't get three times as much from it. Attacking squads take any
  outpost on their lane on the way. The Holding setting keeps a share of
  the squads on an outpost's lane there between attacks (unless their own
  base is under attack); it's off by default because thinner bases made
  Conquest battles about a minute shorter. Outposts aren't
  production, so they never keep a side alive in Conquest, and a knocked-out
  side's outposts go back to their garrisons. They're rebuilt in both modes.
- Siege units (Titans, Howitzers, rocket trucks, Land-trains, Siege
  Crawlers, bombers and the other doctrines' super units) prefer shelling buildings.
- In Eternal mode, destroyed buildings leave rubble and are rebuilt once no
  enemies are nearby, and a faction with no production left gets fallback
  waves. In Conquest, ruins stay ruins.

## Roadmap

1. ~~Foundations: project setup, isometric camera, tilt-shift, procedural
   terrain, ECS and fixed-step loop.~~
2. ~~Units and combat: data-driven unit definitions, low-poly mechs and
   vehicles, sprite infantry, targeting, weapons, health, endless
   reinforcement.~~
3. ~~Buildings and destruction: procedural bases, production buildings that
   spawn units on a timer, decorative buildings, debris, explosions, smoke.~~
4. ~~Light interaction: spawn units, rally points, pick a side, tilt-shift and
   speed controls.~~
5. ~~Pre-battle setup screen and Conquest mode: map size and seed, battle
   pacing, per-unit stat multipliers, faction names and colours, saved in
   the URL; battles that end and roll into a new map.~~
6. ~~Smarter tactics: flanking lanes, so armies use the whole map.~~
7. ~~Pacing and readability: ramp, finer unit stats with resulting values,
   end-of-battle summary.~~
8. ~~More than two factions: free-for-all and teams (2v2, 1v3, ...).~~
9. ~~Capturable outposts, with lanes through outposts and towns.~~
10. ~~Readiness: attack when the army is ready rather than on the tide's clock.~~
11. ~~Movement classes and unit roles (walkers, hovers, boats, aircraft; frontline, artillery, support).~~
12. ~~Line of fire: shots stop at buildings, terrain and units in the way.~~
13. ~~Unit caps per category, with rare super units.~~ Revisit gating
    super units behind outposts once the Commander AI exists.
14. ~~Flat armour, healing in your own territory (replacing the repair
    outpost), AT soldiers in the infantry.~~
15. ~~Faction doctrines, the first three: Armour, Raiders, Legion.~~
16. ~~Aircraft and anti-air: the Scout Copter and flak for everyone, the
    Skyline doctrine.~~
17. ~~The remaining doctrines: Bastion (with the howitzer as its
    signature unit), Talon, Tidewater, Firestorm.~~
18. ~~Balancing tools: damage and time on the field per unit type,
    per-cap-slot numbers, map types in the doctrine array, margins of
    error, comparing runs, and duels.~~
19. ~~Maps: biomes with their own town styles, map shape, base layouts,
    several towns with districts, waterways and bridges, and the ground
    layer that lets the map change mid-battle.~~
20. Next: outpost types (airstrip, hilltop gun, comms relay, fuel depot,
    ruined factory), placing bases, towns and outposts by hand on the setup
    screen, and the first mid-battle map changes (scrap piling up, dense
    forest).
