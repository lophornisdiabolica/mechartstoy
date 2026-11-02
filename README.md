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
the counts, and `--list` shows the scenarios. Every battle is saved to
`sims-results/` (JSON and CSV) with a link that replays it in the browser:
each battle's seed is named after its scenario and number (`1v1-7`), so the
same battle plays out the same way on any machine. The scenarios live in
`src/sim/simulate.ts`; PRs that change the balance add to them and say which
to run.

The page opens on a **setup screen** over a battle that's already running.
Pick a mode, map size, water and hills, army pacing, per-unit stat
multipliers and the sides (two to eight, each with a name, colour and team),
then start. Setup sections fold away; the page remembers which are open. Everything you change
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
  each other, attack the same enemy together, start next to each other and
  come to help when a teammate's base is attacked. "Team boost" evens out
  uneven teams: sides on smaller teams get more production and a bigger
  unit cap, (largest team ÷ their team) to the power of the setting. The
  default, 0.85, gives one side against three about 2.5 times as much,
  which came out roughly even in 1v3; uneven battles are never quite fair,
  so it's a slider. More sides
  make a bigger map.
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
    battlefield.ts   heightmap generation, heightAt/isWater/slopeAt, base sites
    props.ts         scenery placement (trees, rocks)
    settlements.ts   base and town layouts (building placements as data)
    moveClasses.ts   movement classes (foot, tracked, walker, hover, amphibious, naval, air) and their terrain rules
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
    terrainMesh.ts   low-poly ground, soil skirt and water
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
  app.ts     session flow: one renderer and loop, a battle at a time, setup in between
```

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
  costs show up as routes. Aircraft fly straight at `altitude`, only bump
  into other aircraft, and can only be shot by weapons whose `targets` is
  `air` or `both`. There are no hover, boat or air units yet.
- **Roles** (`Role` in `game/units.ts`). *Frontline* units lead and close
  in. *Artillery* fires from near its longest range and backs away
  from enemies inside its minimum range. *Support* (no units yet) follows a little behind the
  nearest frontline ally and doesn't chase. Weapons reach up to 15%
  further from high ground (`effectiveRange` in `systems/targeting.ts`).
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
  units on timers, plus guard towers. A civilian town sits in no-man's land.
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
  bunker then switch sides. Holding one gives a bonus (`OutpostBonus`):
  most speed up production, some repair the holder's units nearby; the
  Outposts bonus setting scales them. A production bonus adds the same to
  every side (+10% of a normal side's rate), so a side boosted for uneven
  teams doesn't get three times as much from it. Attacking squads take any
  outpost on their lane on the way. The Holding setting keeps a share of
  the squads on an outpost's lane there between attacks (unless their own
  base is under attack); it's off by default because thinner bases made
  Conquest battles about a minute shorter. Outposts aren't
  production, so they never keep a side alive in Conquest, and a knocked-out
  side's outposts go back to their garrisons. They're rebuilt in both modes.
- Siege units (Titans, Howitzers) prefer shelling buildings.
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
12. Next, per the design notes: line of fire (shots hit buildings and
    terrain), unit caps per category with rare super units, healing in your
    own territory, then faction doctrines.
