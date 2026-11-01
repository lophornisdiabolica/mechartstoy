# Mech Battle Toy

A browser toy where two factions of little low-poly mechs fight a
procedurally generated battle on a tilt-shifted isometric diorama, either
forever or until one side is wiped out.

## Running

```sh
npm install
npm run dev      # local dev server with hot reload
npm test         # unit tests (headless, no browser needed)
npm run build    # typecheck + production build into dist/
```

The page opens on a **setup screen** over a battle that's already running.
Pick a mode, map size, water and hills, army pacing, per-unit stat
multipliers and faction names and colours, then start. Everything you change
is written to the page URL, so a link reproduces a setup (and, during a
battle, its exact map via `seed`).

- **Eternal:** ruined buildings are rebuilt and the war never ends.
- **Conquest:** no rebuilding. A side loses when its HQ and every production
  building are destroyed; after a short victory banner a fresh map starts
  with the same settings. "Set up after this battle" goes to the setup
  screen instead, and "End battle and set up" goes there right away.

**Controls:** WASD / arrows or right-drag to pan, wheel to zoom, Q / E to
rotate, T toggles tilt-shift, space pauses, 1-4 set speed, Esc cancels.

The **Battle controls** panel (top right) sets speed and camera effects. Pick a
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
    navGrid.ts       route-planning grid (water, steep ground, buildings) and A*
  game/      simulation
    components.ts    component definitions (Transform, Mover, Armed, ...)
    units.ts         unit and weapon definitions (stats are data)
    buildings.ts     building definitions: production, defences, civic
    spawn.ts         assembles unit and building entities from definitions
    tide.ts          alternating offensives that keep the front moving
    lanes.ts         attack routes (centre and two flanks) and which squad takes which
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
    tiltShift.ts     tilt-shift blur + colour grade passes
    terrainMesh.ts   low-poly ground, soil skirt and water
    propsMesh.ts     instanced scenery
    models.ts        model registry and rig (turret / animation hooks)
    models/          unit, building and projectile models
    entityView.ts    mirrors ECS entities into the scene each frame
    effects.ts       particles for flashes, explosions, smoke, debris
    markers.ts       rally flags and the selection ring
  ui/
    controls.ts      in-battle panel and map clicks; changes the sim only via Game commands
    setupScreen.ts   pre-battle settings screen
    settingsUrl.ts   settings <-> URL query string (only non-default values)
    dom.ts           small DOM helpers
  app.ts     session flow: one renderer and loop, a battle at a time, setup in between
```

### Conventions

- **Data in components, logic in systems.** New behaviour is a new component
  plus a system, registered in `game.ts` in the right order.
- **Determinism.** The sim runs at a fixed 30 Hz and only uses `Rng`
  streams forked from the map seed. Don't use `Math.random()` in `game/` or
  `world/`.
- **Coordinates.** x is the long axis (faction 0 on -x, faction 1 on +x), z
  across, y up. Heading 0 faces +x; models are built facing +x.
- **Adding a unit.** Add an entry to `UNIT_DEFS` in `game/units.ts`, register
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
- **Settings.** Tuning the player can change lives in `BattleSettings`
  (`game/settings.ts`). Systems read it from `ctx.settings` every tick, and
  use `ctx.units` / `ctx.buildings` (the definitions with multipliers
  applied) rather than `UNIT_DEFS` / `BUILDING_DEFS` directly. To add a
  setting: add it to the type and `defaultSettings()`, give it a range in
  `LIMITS`, a URL key in `ui/settingsUrl.ts` and a control in
  `ui/setupScreen.ts`.
- **Factions.** `NEUTRAL` (-1) is the civilian town: nobody targets it, but
  splash damage hurts it.
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
- The **tide** (`game/tide.ts`) alternates the sides between massing at a
  rally point and attacking in force, with production surging for whoever
  is attacking. Which side surges first is a coin flip per map. In Eternal
  mode a mild rubber band helps a badly outnumbered side; Conquest lets an
  advantage snowball so battles end (about 4 to 12 minutes on a medium map).
- Attacks follow **lanes** (`game/lanes.ts`): one down the middle and one
  swinging wide along each side. Units built together form a squad and
  share a lane. Each attack a side favours one flank, and the Flanking
  setting decides how many squads go wide, so fights break out all over
  the map rather than along one front line.
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
