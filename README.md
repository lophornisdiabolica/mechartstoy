# Mech Battle Toy

A browser toy where two factions of little low-poly mechs fight an endless,
procedurally generated battle on a tilt-shifted isometric diorama.

## Running

```sh
npm install
npm run dev      # local dev server with hot reload
npm test         # unit tests (headless, no browser needed)
npm run build    # typecheck + production build into dist/
```

Add `?seed=anything` to the URL to reproduce a battlefield.

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
  game/      simulation
    components.ts    component definitions (Transform, Mover, Armed, ...)
    units.ts         unit and weapon definitions (stats are data)
    buildings.ts     building definitions: production, defences, civic
    spawn.ts         assembles unit and building entities from definitions
    tide.ts          alternating offensives that keep the front moving
    orders.ts        per-faction player orders (stance, rally point)
    context.ts       shared services and the game event types
    factions.ts      faction names and colours
    systems/         one file per system (ai, movement, weapons, ...)
    game.ts          wires world + battlefield + systems together
  render/    Three.js view
    stage.ts         renderer, scene, lights, post-processing chain
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
    controls.ts      control panel and map clicks; changes the sim only via Game commands
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
- **Factions.** `NEUTRAL` (-1) is the civilian town: nobody targets it, but
  splash damage hurts it.
- **Adding a model.** Call `registerModel('key', faction => object3d)` and
  give entities `Renderable { model: 'key' }`. Use `setRig` to expose a
  `turret` (aimed automatically from the `Armed` component) or an `animate`
  hook (walk cycles etc.).
- **Effects** listen to game events (`fired`, `impact`, `unitDestroyed`) and
  never touch the simulation.
- **Transforms** keep previous-tick values (`px`, `py`, ...) so rendering can
  interpolate between sim steps. The snapshot system must stay first.

## How the battle keeps going

- Each base has an HQ, barracks, vehicle factory and mech bay that produce
  units on timers, plus guard towers. A civilian town sits in no-man's land.
- The **tide** (`game/tide.ts`) alternates the sides between massing at a
  rally point and attacking in force, with production surging for whoever
  is attacking. A mild rubber band helps a badly outnumbered side.
- Siege units (Titans, Howitzers) prefer shelling buildings.
- Destroyed buildings leave rubble and are rebuilt once no enemies are
  nearby; a faction with no production left gets fallback waves.

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
5. Pre-battle setup screen: map size and seed, battle pacing, per-unit stat
   multipliers, faction names and colours, saved in the URL.
