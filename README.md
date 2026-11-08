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
npm run bench    # sim speed on fixed battles, with a fingerprint of the result
npm run map -- "seed=abc&biome=desert"   # the map a battle would get, as a PNG
npm run shot -- 1v1-7 --at 12m           # a screenshot from the real renderer
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

To dig into particular battles: `--seeds 3,7-9` plays just those battle
numbers of each scenario (with the doctrines and map types they get in a
full run), and `--battle 1v1-7` plays one battle on its own and prints its
**timeline** (every side's units, buildings, production, outposts, kills
and attacks every 30 seconds) and where the sim's time went. `--from
sims-results/x.json` takes that battle's doctrines, map type and settings
from a saved run. `--timeline` saves timelines for every battle in the
JSON, and `--profile` prints how long each part of the sim took (per
system, see `World.profile`) and the slowest tick.

Every battle also gets a **score beyond win or loss**: each side's team's
share of all the armies' fighting strength, averaged over the battle, and
for a won battle the **margin**, the winners' share at the end. The
doctrine table shows the share against par as **Strength** (1.00x is even),
over every battle a doctrine played, won, lost or undecided, so a close loss
counts for more than a rout and fewer battles give a clear answer;
`--compare` compares it too.

`--sweep "tforce=0,0.35,0.7"` plays the same battles once per value of a
setting (any setting as written in a battle's link, or a unit's stat
multiplier written `skimmer.hp=0.9,1,1.1`) and prints lengths, wins,
margins and doctrine win rates and strength per value side by side, for
sizing a change before making it.

`--latin` (two-sided scenarios, with `--maps`) separates matchups from
maps: every pairing of two different doctrines meets every map type once,
taking turns at which is side 1, and the results are shown per pairing and
map type, with the pairings each doctrine wins on some map type and loses
on another. That's 28 battles per map type (112 on four), against the
doctrine array's 64 or 128 where each pairing lands on one or two map
types.

To watch a battle at a particular point, add `&at=25m` (or `90s`, or
`12:30`) to its link: the battle opens straight away, fast-forwarded to
that point in the worker, and plays on from there.

### Performance

`npm run bench` plays three fixed battles (1v1 medium, 2v2 large, an
8-side free-for-all on a large map) for five minutes each, one at a time,
and prints milliseconds per tick (mean, median, 95th percentile, slowest
and when), the slowest systems, and a **fingerprint**: a hash of where
every entity ended up. A change meant only to make the sim faster must
keep every fingerprint; `--compare a.json b.json` shows the timing changes
and whether the battles still played out the same. CI does this on every
pull request (two minutes per battle, on the PR and on the branch it
targets) and puts the comparison in the **Same battles as main** job's
summary, with a warning when the battles changed, which is expected for a
balance change and a bug in a speed-up. In the browser, **P** shows the
same numbers live, with draw calls, triangles and meshes.

`npm run map -- WHAT` draws the map a battle would get, top down, as a PNG
in `maps-out/`: WHAT is a battle link or query string, or a sims seed such
as `1v1-7`. `--count N` draws N seeds of it, `--set` changes settings.

`npm run shot -- WHAT` saves screenshots of a battle from the real renderer,
in headless Chromium (it needs Playwright: `npm i -D playwright && npx
playwright install chromium`), to `shots-out/`. `--at 12m` fast-forwards
first, `--look x,z,zoom` (or `base2`, or `fight` to follow the fighting)
points the camera, `--every 30s --count 6` takes a series, `--clean` hides
the HUD and panel, `--plans` shows the Commanders' plans, and `--size`
sets the picture size. `npm run shot -- --help` lists the rest.

In the browser, **O** opens the **debug overlays**: every side's lanes
and rally points, each unit's planned route, targets and line of fire
(red where a shot is blocked, with a line to the spot the unit is moving
to for a clear one), the strength map the Commanders read, and what the
ground costs each movement class to cross. They stay on across battles
until switched off.

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
  works out to (HP, damage per second, speed, range, and below that armour
  and damage per hit) under its box. Units are grouped in folding sections:
  the ones every side builds, then each doctrine's own.
- **Between battles** a new battle can re-roll the map, biome, style, sides
  and doctrines. Re-rolled sides go free-for-all, two even teams, two uneven
  teams (1v3, 2v4...) or any of those. With repeats on (the default) a
  doctrine can turn up more than once; the repeat gets a name and colour of
  its own (Jade Vanguard, Rust Brigade...).
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
  centre, houses round them, and a paved main street; **roads** join the
  towns, along the easiest ground. **Waterways** (on by
  default) dig channels joining the water near the bases, so boats can
  sail from one to another; from 60% water every base gets water, with an
  inlet dug to any that has none. Wherever water cuts the land, an
  indestructible **bridge**, just wide enough for the biggest walkers (who
  would rather go round by land), carries land units over while boats pass
  underneath. Bridges reach on past a corner of the shore until their whole
  width lands, ramp gently, and cut a way into a bank that rises above
  them. **Dense forest** (a slider) grows patches of big trees, distinct
  from the light woods: they stop shots, so infantry find cover in them,
  and slow vehicles, which flatten the trees they drive into; shots and
  blasts knock them down too, and a cleared patch is open ground again.
  **Scrap** (on by default): where enough vehicles are wrecked, the ground
  turns to scrap, a slog for tracks and hovers and easy for long legs,
  until it's cleared away four minutes later.
- **Placement:** a map of the battle the settings make, on the setup
  screen, where the bases, towns and outposts can be dragged to new spots.
  Dropping one fixes where every one of its kind goes (kept in the link as
  `bpos`, `tpos` and `opos`); the map is generated round them. Changing the
  number of sides, towns or outposts, or the base layout, goes back to
  automatic placement for that kind.
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
  - *Skyline:* gunships, bombers, strike jets and scout copters from its
    **airpad**, battle tanks and flak walkers from the factory; 2.5× air
    cap, 0.8× infantry and vehicles. Bombers and jets are planes: they
    never stop, circling where they were sent when there's nothing to do
    and attacking in runs straight over the target. Gunships, bombers and
    jets carry so many shots, then fly back to the airpad to rearm
    (gunships set down on it). Every aircraft banks into its turns, and a
    shot-down one flies on as it falls and explodes where it hits.
    Super unit: the Airship Carrier, a slow armoured airship that launches drones.
  - *Bastion:* howitzers (its signature unit), railgun batteries (long,
    flat, armour-piercing shots), battle tanks and flak tanks, a **sensor
    mast** and two extra guard towers; 1.1× vehicles. Howitzers and
    railguns shoot further than their crews can see; inside the mast's
    30-unit radius, the Fortress Walker's 26, or 14 round any of its scout
    copters, they fire at their full range. Super unit: the Fortress Walker.
    *Bastion (spider test)*, under "Test" in a side's doctrine list and
    nowhere by default, swaps it for the Siege Spider: a giant
    eight-legged howitzer that spots for itself and climbs over buildings.
  - *Talon:* packs of three striders, spider walkers (which take any slope
    as easily as flat ground, climb straight over buildings and walls,
    and shoot at aircraft) and Warhound heavy walkers from the factory and a **mech
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
    best for clearing towns. It keeps burning where it lands
    (`game/fire.ts`): hot at first, cooling to scorched ground that
    smoulders for a while; several flamers on one spot make it white-hot,
    which burns straight through armour. Every flame unit carries fuel:
    badly hurt, it breaks off and drives at the nearest enemy, and it
    explodes when destroyed. Super unit: the Inferno Walker.
  - Walkers (on any side) step over walls, and don't waste shots on them.
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
  mech bay, and losing one is a real setback: the bay starts the next from
  scratch, a full build time away, whatever it had done while capped. The super cap can grow during a battle, with the tide ramp (up
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
rotate, F follows the fighting, T toggles tilt-shift, G opens the god powers,
H opens photo mode, space pauses, 1-4 set speed, Esc cancels.

The **Battle controls** panel (top right) sets speed and camera effects.
**Follow the fighting** turns the camera into a spectator that glides to
wherever the biggest fight is (panning by hand turns it off). **Shadows**
High / Low / Off trades looks for speed in huge battles; shadows are only
drawn around the part of the map in view either way. Both are remembered
in this browser rather than in the battle link. Click any unit or building
to inspect it.

The **God powers** tab (the button beside the panel, or G; × hides it again)
is everything you can do to the battle. There are no cooldowns: it's a toy.
Pick the side you're acting for, then:

- **Orders**: Attack / Hold / Auto for that side (Auto follows the ebb and
  flow of the battle), a rally flag, or the same for every side at once.
- **Bless or curse** a side for 30 s, a minute or two: faster production,
  healing wherever its units are (gold motes rise off them), or a curse
  that withers them (dark wisps). Lift ends them early.
- **Airstrike**: drag a line and bombers fly it. Light (many small bombs,
  for infantry), Heavy (fewer big ones that crater the ground), Carpet
  (three bombers abreast) or the Big one (one huge bomb on a point, a deep
  crater and a long shake). Bombs hurt every side.
- **Earthquake**: Tremor, Quake or Cataclysm. The ground heaves into ridges
  and hollows (routes and line of fire follow), buildings crack, trees
  fall and the camera shakes.
- **Shape the land**: hold and drag to raise, lower (down into a lake) or
  flatten ground, plant dense forest or fell it, with a small, medium or
  large brush; drag a bridge across water, or a wall (nobody's, so it
  blocks everyone until it's shot down).
- **Drop units**: any unit, 1 to 25 at a time in a ring, for the side
  you're acting for. Caps don't apply, so a dozen Titans is fine.

The **battle ticker** (top left, on by default) is a quiet feed of what's
happening: outposts changing hands, super units falling and where ("at the
fuel depot in the north", "on a bridge", "outside Crimson Host's base"),
production buildings razed, attacks setting out, sides knocked out. **Show
front lines** shades the ground in the colour of whoever holds it, from
where each side's strength is (buildings hold the ground they stand on),
greyer where it's contested; the front is where the colours meet. Both are
remembered in this browser.

**Photo mode** (H, or the button in the panel) hides the interface and puts
a small bar at the bottom: tilt the camera from nearly flat to straight
down, zoom in much closer, set the time of day (dawn to dusk: the sun
moves and the light warms as it gets low), adjust the tilt-shift, pause,
and save the picture as a PNG. H or Esc leaves it, putting the camera
and light back.

When a battle ends, the banner shows a **chart** of each side's army
strength through the battle, the **turning point** (when the winners took
the lead in strength for good, or that they led throughout, or won on the
buildings without the bigger army) and the **unit of the battle**, the type
with the most kills on any side.

## Architecture

The simulation and the renderer are separate. The game can run headless
(the tests do this), and the renderer only reads game state.

In the browser the battle plays in a Web Worker (`src/sim/simWorker.ts`),
so the sim and the drawing use separate CPU cores. The page builds its own
copy of the battle from the same seed and settings, a view `Game` with no
systems, and after each batch of ticks the worker sends what changed:
positions, the components the page reads, events, map changes, fallen
trees and the side, outpost and order state (`src/sim/mirror.ts`). The
renderer and UI read the view exactly as they'd read the real game, and
player commands (rally, stance, dropping units, live settings) go to the
worker through `Game.command`. A page feature that reads something new
from the battle adds it to what mirror.ts copies. `?worker=0` plays the
battle on the page instead, as before.

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
                     bridges, roads, and changing the map mid-battle (paint, setGround, reshape, onChange)
    roads.ts         roads between towns, along the easiest ground
    mapPicture.ts    top-down map pictures as RGBA pixels (setup map, npm run map)
    woods.ts         dense forest: trees that stop shots, fall to them and get flattened by vehicles
    ground.ts        kinds of ground (plain, road, scrap, dense forest) and what they cost each movement class
    waterways.ts     channels joining the bases' water, and bridges (fitted to their banks) wherever water cuts the land
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
    commander/       each side's planner above the squads (see "The Commander" below)
      commander.ts     each side's picture of the battle (army, strength, make-up, enemies' make-up) and its goals
      strength.ts      strength map: each side's fighting strength per 6-unit cell, on the ground, in the air and against aircraft
      places.ts        the map's key places: bases, outposts, towns, bridges, narrow crossings and high ground
      taskForces.ts    squads sent off between attacks to take outposts or save the side's own
      advice.ts        production advice (leaning each doctrine's table toward what the battle needs) and per-side styles
      roles.ts         jobs that suit the unit: flak covering against aircraft, artillery on high ground, escorts for super units
    lanes.ts         attack routes (centre, and through outposts and towns) and which squad takes which
    outposts.ts      capturable outposts: their kinds, garrisons, capturing, bonuses
    scrap.ts         wreckage piling up into scrap, and being cleared
    caps.ts          unit caps per category, and when super units can be built
    territory.ts     territory (bases and held outposts), healing and squad refills there
    orders.ts        per-faction player orders (stance, rally point)
    god.ts           god powers: airstrikes, quakes, the land brush, forest, bridges, walls, blessings (commands, off unless used)
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
    terrainMesh.ts   low-poly ground, soil skirt, water, bridges and road strips; redraws cells the map changes
    woodsMesh.ts     the dense forest's trees, lying down where they've fallen
    propsMesh.ts     instanced scenery
    models.ts        model registry and rig (turret / animation hooks)
    models/          unit, building and projectile models
    entityView.ts    mirrors ECS entities into the scene each frame (posed models, drawn through the batcher)
    batcher.ts       draws every model part as instanced batches: boxes as one scaled unit box, flat colours per instance
    effects.ts       particles for flashes, explosions, smoke, debris
    markers.ts       rally flags and the selection ring
    outpostRings.ts  capture rings round outposts, filling as a side takes one
    commanderOverlay.ts  each side's plan as arrows on the map, and markers on crossings, bridges and high ground
    frontLines.ts    front lines: who holds which ground, shaded from a strength map
    debugOverlay.ts  debug overlays: lanes, routes, line of fire, strength map, route costs
  ui/
    controls.ts      in-battle panel and map clicks; changes the sim only via Game commands
    godPanel.ts      the god powers tab: orders, drops, blessings, airstrikes, quakes, land, forest, bridges, walls
    setupScreen.ts   pre-battle settings screen
    mapPreview.ts    the setup screen's map, for placing bases, towns and outposts by hand
    perfOverlay.ts   render and sim stats readout (P)
    ticker.ts        the battle ticker's feed
    battleChart.ts   army strength through the battle, for the end-of-battle chart
    photoMode.ts     photo mode (H): no interface, free camera, time of day, save a picture
    debugPanel.ts    the debug overlays' switches (O)
    settingsUrl.ts   settings <-> URL query string (only non-default values)
    viewPrefs.ts     display preferences (shadows, follow) kept in this browser
    dom.ts           small DOM helpers
  sim/
    simulate.ts      headless balance scenarios and stats (npm run sims; scripts/sims.mjs runs them)
    duel.ts          unit-against-unit duels on open ground (npm run sims -- --duel)
    bench.ts         fixed battles timed for npm run bench, with result fingerprints
    mapTool.ts       settings and pictures for npm run map (scripts/map.mjs)
    mirror.ts        the worker's battle copied onto the page's view of it, frame by frame
    simWorker.ts     the Web Worker that plays the battle
    remoteSim.ts     the page's end of the worker: asks for ticks, applies frames
  app.ts     session flow: one renderer and loop, a battle at a time, setup in between
```

### Changing the map mid-battle

The map isn't fixed once generated. `Battlefield.paint(x, z, radius,
ground)` and `setGround(cells, ground)` lay a kind of ground (scrap, a
road), `addRoad` paves a line, `reshape(x, z, radius, fn)` changes heights
(a canal, a wall's footing) and `addBridge` adds a bridge. Each tells
everything listening through `onChange` which cells changed: the route
grids recompute those cells and their connected regions and bump their
version (so routes through those cells re-plan, as they do when buildings go up or down), and
the terrain mesh redraws them (and any road over them). Scrap from wrecks
(`game/scrap.ts`), dense forest being cleared (`world/woods.ts`) and the
god powers (`game/god.ts`: craters, quakes, the land brush, planted forest,
bridges) use it now; walls, canals and towns that engineers grow can use it later. Lanes,
outposts and the light scenery are still placed once, at the start.

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
  through gaps it fits. Routes are shared and kept (Commander step 5): a
  map or building change only re-plans routes whose cells it touched
  (`NavObstacles.changedSince`, which remembers the last 256 changes), and
  a unit setting off from about where another just planned from (within
  two cells), to about the same place and of about the same size, takes
  that route for 2 seconds after it was planned, so a squad or task
  force plans once. On the 8-side large battle that cut route planning
  from about 45,000 plans in 5 minutes to 12,000. Spawning (`spawnSpot` in `systems/production.ts`)
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
- **The Commander** (`game/commander/`). A planner per side, being built
  in steps above the squad AI. Every two seconds it rebuilds each side's
  picture of the battle (where its army is, its fighting strength on the
  ground, in the air and against aircraft, a strength map in 6-unit cells,
  what kinds of unit it and its enemies field) and states the team plan
  above as goals: mass or regroup at the rally point, push an enemy base,
  or defend home. It also knows the map's key places, found once while the
  map loads.
- **Task forces** (`game/commander/taskForces.ts`). Between attacks, the
  Commander can send up to 35% of a side's army (the *Task forces* setting
  under Outposts; 0 turns them off) to take an outpost its team doesn't
  hold, or to save one of its own that an enemy is taking. It picks the
  cheapest outpost it can beat: a force needs 1.6× the enemy strength
  there (garrison, guards and armies), and nearer outposts come first. Up
  to two forces at once; the nearest free squads go. A force that's down
  to 45% of its strength, or hasn't taken its outpost in 100 seconds,
  comes back, and the side waits 45 seconds before trying there again.
  Once taken, the force holds the outpost. When the team attacks, every
  force joins the attack, and an attack on the side's base calls them all
  home. Boats and super units stay with the main army. The rally flag and
  any stance but auto override task forces.
- **Jobs that suit the unit** (`game/commander/roles.ts`). Flak (flak
  tanks and walkers) goes to whatever of its side's the enemy's aircraft
  are over (its base, its army, outposts it holds, its task forces), where
  its side has least anti-air for them, and a task force heading where
  there are enemy aircraft takes flak first. Between attacks, artillery
  waits on the highest ground within 30 units of the rally point (if it's
  at least 1.5 higher, and not out in front). On an attack, the three
  nearest vehicles keep round each super unit. Like task forces, the rally
  flag and stances override these, and an attack on the base calls
  everyone home except the flak.
- **Production advice and styles** (`game/commander/advice.ts`). Within
  its doctrine's own table, each side's Commander leans production toward
  what it's short of, by at most the *Build advice* setting (±30% of a
  unit's weight by default; 0 is off). Short of anti-air against enemy
  aircraft, it builds more flak (and other guns that can shoot aircraft,
  at half the lean), and less with no aircraft about; against an enemy
  that's mostly armour, more hard hitters (35+ damage a hit); against one
  that's mostly infantry, more that sprays (splash, or light guns). Each
  side also has a style, picked next to its doctrine: *balanced*;
  *cautious* (half the task forces, wants 1.25× the edge before a team
  attack, prefers near outposts); *aggressive* (1.3× the task forces,
  attacks with 0.8× the edge); or *raider* (1.7× the task forces, goes for
  far-off outposts, and leans production toward fast units).
- **Engineers** (`game/commander/engineers.ts`). Every doctrine's HQ
  trains engineers (one every 40 seconds, up to the *Engineers* setting
  under Armies, 2 by default; 0 is off) when its Commander has work for
  them. For now the work is fortifying where the army masses: a line of
  three wall segments 7 units in front of the rally point, facing the
  enemy base, for each of the two nearest enemies, with a field tower (a
  guard tower; at most two per side) just behind it. A wall stops shots like
  any building, so it's cover, and attackers have to go round it or knock
  it down. Walls crumble over ten minutes and towers over fifteen; neither
  is rebuilt (no rubble),
  and a side has at most six standing. Engineers don't build where an
  enemy unit is within 14 units, take no cap, never join an attack or a
  task force, and wait at home when there's nothing to build; the rally
  flag and stances pause their work. Docks, hover pads, bridge repairs
  and canals are still to come.
- **Keeping out of where they're weak** (`game/commander/threats.ts`).
  Each Commander maps how dangerous every part of the field is to
  infantry (artillery, big blasts and flame most), vehicles (hard
  hitters) and aircraft (flak), spread over each weapon's reach plus a
  margin. What's avoided is a kind's counters, not the enemy as a whole:
  the danger beyond that kind's usual share of the enemy's danger. At the
  start of each attack, a squad whose lane has its counters gathered on it
  takes the lane where they aren't, so infantry go round the side the
  enemy's artillery covers; on the march, a squad about to walk into
  counters that outgun it swings out to whichever side is safer, then
  carries on (aircraft go round flak the same way). Squads already
  fighting don't detour. *Keep out of where they're weak* under Armies
  turns it off (URL `avoid=0`).
- *Show plans on the map* (Commanders section of the panel) draws each
  side's goals as arrows (fainter the less ready it is) and each task
  force's arrow to its outpost; the list under it says each side's plan
  in words.
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
  bunker then switch sides. Each outpost is one of six kinds
  (`OUTPOST_KINDS`; the setup screen picks which the map deals out), with
  a building of its own and a bonus for its holder (`OutpostBonus`; the
  Outposts bonus setting scales it): a *supply depot* (+10% production), an
  *airstrip* (+2 aircraft cap), a *hilltop gun* (a long-range gun on the
  highest outpost, firing for whoever holds it), a *comms relay* (the
  holder's team grows impatient 40% faster while massing, so its attacks
  set out sooner, and the mast spots for its guns), a *fuel depot* (+10%
  production, and its tanks blow up) and a *ruined factory* (turns out one
  of the holder's factory batches every 75 seconds). Every outpost makes
  the ground round it the holder's territory (see below). A production bonus adds the same to
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
20. ~~Outpost kinds, placing bases, towns and outposts by hand, roads
    between towns, bridges fitted to their banks, and the first mid-battle
    map changes: scrap piling up, and dense forest that gets knocked down.~~
21. The Commander AI: battle picture, task forces, jobs that suit the
    unit, production advice and styles, shared routes, and engineers who
    build walls. Next: engineers that repair bridges, put up docks and
    hover pads and dig canals; then aircraft that fly like planes.
