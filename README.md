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
npm run fps      # drawing speed on fixed scenes: page and GPU time per part of each frame
npm run map -- "seed=abc&biome=desert"   # the map a battle would get, as a PNG
npm run shot -- 1v1-7 --at 12m           # a screenshot from the real renderer
npm run sounds   # every sound as a WAV plus a spectrogram PNG, with a loudness/frequency report
```

### Sound

All sound is synthesized in code (`src/audio/synth.ts`): no sample files.
The recipes are rendered once into clips in a worker when sound starts
(on the first click or key press), and the battle's events play them,
placed by where the camera looks. The panel's Sound section has mute (M),
volume, a Focus slider for how closely the sound follows the camera, and
a mix per category (gunfire, cannons, artillery, buildings, chimes,
ambience); settings are kept in this browser. `docs/audio.md` explains
how the sounds were designed and checked.

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
tighter numbers per map at that many times the cost. The niche report
(`--niche`) also splits each doctrine's win rate between the shorter and
the longer half of the battles, which shows a doctrine that wins early
and fades, or one that only comes good in long battles.

`--mix` (and `--niche`) prints the **army mix over time**: for each
doctrine, the units it had alive by type in each stretch of the battle
(0-5 minutes, 5-10 and so on), averaged per side and as a share of its
army, pooled over every battle it played while it was still in the war.
It answers questions like "what is Aegis's army made of late on?" without
a one-off script. Every battle records it, so `--pool` prints it for
saved runs too.

`--moments` lists each battle's **big moments**, longest battles first:
super units falling, production buildings lost, sides knocked out, and
the winners' closest call (their lowest share of the armies' strength),
each with a link that opens the battle 20 seconds before it (`&at=`).
`--moments --from sims-results/x.json` lists a saved run's moments
without playing anything (add `--battle 1v1-7` for just that one), so
the interesting battles of a big run are easy to find and watch.

`--compare a.json b.json` compares two saved runs without playing anything:
battle lengths, doctrine win rates (flagging changes bigger than the
noise), how many of the same battles changed winner, and the units whose
damage per cap slot moved most. Run the same command before and after a
change and compare the two.

`--baseline main` does both in one go: it plays the same battles on
another version of the code (a branch, tag or commit) first, in a
temporary copy it removes afterwards, then on this one, and prints the
`--compare` report between them. Both runs are saved. With no change to
the sim in between, every battle comes out the same.

`--trace LINK` replays the battle a link shows (the page's whole address,
or just what follows the `?`) and writes down **what each Commander is up
to**: every 30 seconds (`--every 1m` to change it) its plan (massing, and
how much of the army it needs it has; attacking; regrouping; defending;
all in for the hill), each side's army and where it stands (home, on the
hill, at an enemy base, in the field), and in between the moments a plan
changes, an outpost or the hill changes hands, the hill's clock runs down
or a super unit falls. It stops at the end or at `--minutes` (default
60). For "why did the AI do that?": paste the link of the battle where it
happened. The code is in `src/sim/trace.ts`.

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
full run), `--latin --involving aegis,rime` plays just the Latin battles
that have one of those doctrines on a side (against every doctrine, with
the same battle numbers as a full run, so it pools and compares with
one), and `--battle 1v1-7` plays one battle on its own and prints its
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

The drawing has its own numbers. **P** also shows where each frame's
time goes on the page, part by part (`units` posing and batching the
models, `wreckage`, `effects`, `sim snapshot` reading the worker's state,
`draw: scene`, `draw: shadows` and `draw: post` handing the frame to
three.js, the HUD and audio), and GPU milliseconds per pass (scene,
shadows, post) where the browser has GPU timers (Chrome and Edge do; see
`src/render/renderProfile.ts`), with draw calls split into the shadow
pass and the rest, triangles, and how many models were drawn of how many
there are (models off screen aren't; see `EntityView.cull`). Frames whose
page work runs past 25 ms go in a **hitch log** with the parts that took
the time (and to the console). The **Cost check** button turns shadows,
the tilt-shift blur, multisampling, half the pixels, and
each layer (terrain, woods and props, wreckage, units, effects) off in
turn for a moment on whatever's on screen, and reports what each saved
in page and GPU time on this machine. Where the browser has no GPU
timers, each frame waits for the GPU during the check (a one-pixel
read-back), and "GPU done" is how long after the frame began the GPU had
finished it. **Copy** puts the readout and the last check on the
clipboard.

What keeps the drawing cheap: the dense forest and the roads are drawn in
map squares, so squares off screen or out of the shadow's reach are
skipped; trees and cacti switch to shapes with fewer sides when zoomed out
(`src/render/plantLod.ts`) and cast their shadows from plainer stand-ins
drawn only into the shadow map (they sit on a layer the screen's camera
doesn't see); a city's streets are merged into a mesh or two per square
instead of one per street; and models with no moving parts that haven't
moved (a city's houses) aren't re-posed each frame.

`npm run fps` does the same headlessly on fixed scenes (the bench battles
at 5, 10 and 25 minutes, the whole map or close on a fight): page time by
part, GPU time by pass, frame time, draw calls; `--compare a.json b.json`
diffs two runs, `--cost` adds the cost check, `--cpu-profile` saves a
profile for Chrome DevTools' Performance tab, and `--paused` measures a
frozen moment. Headless Chromium draws in software, so its page times are
real but its frame times aren't: on a machine with a GPU, `--headed` (or
`--channel chrome`) gives real frame and GPU times.

`npm run leaks` checks that a long battle settles down instead of piling
up memory: it plays an Eternal battle headlessly for 90 minutes and
prints, every 10, the live entities, the JS heap after a garbage
collection, and every collection (Map, Set or array) reachable from the
battle that kept growing after the first 20 minutes by more than the
entities did, such as a cache keyed by something that never repeats. It
exits with an error if anything did. `--minutes`, `--every`, `--warmup`,
`--set` and `--seed` change the battle; collections with a cap in the
code are listed in `BOUNDED` in `src/sim/leaks.ts`. It can't see inside
closures (a system's own local state), so the heap line is the backstop
for those. `--page` checks the page instead: it plays `--battles`
battles back to back in headless Chromium, as ambient mode does, and
prints the GPU geometries, textures and shader programs, scene objects,
DOM nodes and JS heap after each. A 120-minute battle on main held at
27-28 MB with nothing growing, and six battles in a row on the page held
at about 40 geometries, 13 textures and 21 programs.
`test/leaks.test.ts` plays a shorter battle (24 minutes on a small map)
on every test run.

`npm run map -- WHAT` draws the map a battle would get, top down, as a PNG
in `maps-out/`: WHAT is a battle link or query string, or a sims seed such
as `1v1-7`. `--count N` draws N seeds of it, `--set` changes settings.

`npm run shot -- WHAT` saves screenshots of a battle from the real renderer,
in headless Chromium (it needs Playwright: `npm i -D playwright && npx
playwright install chromium`), to `shots-out/`. `--at 12m` fast-forwards
first, `--look x,z,zoom` (or `base2`, `fight` to follow the fighting, `director` or `unit`)
points the camera, `--every 30s --count 6` takes a series, `--clean` hides
the HUD and panel, `--plans` shows the Commanders' plans, and `--size`
sets the picture size. `npm run shot -- --help` lists the rest.

**Model viewer:** open the page with `?models` to see every unit of a
doctrine (or every building) standing on a slope, drawn by the battle's own
entity view. Sliders set the slope, the aim and the guns' elevation; buttons
turn the models round, walk them round a little circle, make the melee units
strike, wreck them (and give another set of wreck poses), and fade the
stealthy ones out. Click a model to look closer. Everything is in the link
(`?models&doctrine=sabre&slope=20&wreck=1`), so `npm run shot -- --models
"doctrine=sabre&slope=20&wreck=1"` takes the same picture again, which makes
checking a changed model a minute's work.

**Arena:** `?arena=reaver*4,lancer*4` (or `reaver*4 vs lancer*4`) puts two
hand-picked groups on open ground in the real page, the duel tool's rounds
(see `--duel`) one after another, with each side's units left, health left
and damage dealt on screen, and the tally of rounds won. `gap=40` sets the
starting distance and the link's other settings (unit multipliers such as
`tank=1.2,1,1,1`, `hills=1.2`) apply as they do to `--duel --set`.

In the browser, **O** opens the **debug overlays**: every side's lanes
and rally points, each unit's planned route, targets and line of fire
(red where a shot is blocked, with a line to the spot the unit is moving
to for a clear one), the strength map the Commanders read, and what the
ground costs each movement class to cross. They stay on across battles
until switched off.

`npm run flicker` plays a battle in headless Chromium, slowed down so
every moment is drawn, and watches how every unit, building and effect
looks: parts shown, how far a unit has faded out, an effect's opacity.
Anything that goes back and forth more than twice in one second of
battle is listed as flicker, worst first, and the command fails. The
default battle is an eight-way free-for-all of the doctrines with the
most going on (Veil, Cipher, Aegis, Rime, Firestorm, Skyline, Sabre,
Tidewater); give it a link or seed to watch another, `--at` and
`--seconds` to pick the stretch. It caught Veil's ghost tanks blinking
between solid and faint four times a second as they hid between shots;
they now stay solid until they've been hidden for 0.6 seconds.

`npm run pairs` takes the same fixed set of pictures (the model viewer
for every doctrine, upright and wrecked, the buildings, and four battle
moments from fixed camera spots) from the branch a change is based on
(`--base`, default `origin/main`) and from the working tree, and saves
each pair side by side in `shots-out/pairs/` with how much of the picture
changed and an `index.html` to look through. CI does this on every pull
request and uploads the pairs as the **screenshot-pairs** artifact.

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

Map sizes run Small, Medium, Large, Huge and Vast. A size is the smallest
the map will be: more sides grow it until every base fits, so eight sides
on any size end up about as big as Vast. Huge and Vast give that room to any
number of sides (a 1v1 on Vast is a long march). Re-rolls and dice between
battles only pick Small to Large.

Hills go up to 3×. **Mountains** and **Cliffs** (both off by default) raise
high ground on top: mountains are tall massifs, up to about twice the usual
hills, steep going most of the way up with sheer crags near the top;
cliffs are flat-topped mesas with sheer sides and a ramp or two up (the
first facing one of the bases). A sheer face is a wall to everything on the
ground except spider walkers, which climb it; aircraft fly over. Only high
ground has sheer faces, and maps with neither setting are the same maps as
before.

Off high ground, a slope stops a unit only when it's both too steep and too
tall for it: each kind of mover gets up slopes to a steepness of its own
whatever their size, and steeper ones only while the face is short (a
crater's lip, a terrace's step, a bank). Hovercraft climb least, then tanks
and trucks, then walkers, then infantry; spiders climb anything. On rolling
hills that's only the odd hillside, but tall hills (2× and up) have whole
slopes tanks go round. Where steep slopes would cut a base, town or
outpost off from a class that could otherwise reach it, the easiest way up
counts as a track it can take. High
ground keeps clear of the base pads, and is taken back off if it would cut a
base off or leave a mesa top out of reach (counting only ways wide enough
for a super unit); towns, cities and outposts keep their own ground level.
The *Mountain passes* and *Mesa country* map styles use them.

**Terrain** sets the lie of the land, laid over the rolling hills before
anything is built on it. Features that run across the map run between the
first sides (north to south when the bases are west and east):

- *Rolling:* the usual map, unchanged.
- *River valley:* a river winding down a broad valley, bridged in two or three places.
- *Ridge line:* a tall ridge with sheer flanks, crossed only at its passes.
- *Canyon:* a deep dry gorge with sheer walls, cut through a raised tableland,
  with two or three places where the walls ease into slopes to cross by.
- *Archipelago:* islands in a shallow sea. Bridges join the bases' islands
  and any town's, hopping island to island in short spans; where open sea
  is too wide for one, a small islet is raised mid-way to carry two.
- *Coastline:* one long side of the map runs down into the sea.
- *Terraced hills:* hillsides stepped into flat terraces.
- *Salt flats:* nearly flat open ground.
- *Crater field:* an old battlefield pocked with craters, the deepest flooded.

Each has a map style of the same name, so re-rolls between battles can deal
them out.

**Outline** sets the shape of the land, with sea beyond it: *Full* (land edge
to edge, the usual), *Island*, *Isthmus* (two lands joined by a narrow neck),
*Ring* (land round a sea in the middle), *Crescent* (an island bowed round a
bay) and *Peninsula* (a long arm of land reaching out from one end). Every
base keeps land round it, and bridges join any base or town the sea cuts
off. *Island*, *Isthmus*, *Inland sea*, *Crescent bay* and *Peninsula* map
styles use them. **Shape** now runs from 2.5× deeper (a long front between
two sides) to 2.5× wider.

**Traits** lay one or more special features over the map, each a headline for
the battle, on contested ground between the sides. Traits take their ground
first, on the way between the bases, and the towns and outposts keep round
them; an attack lane runs through each (the centre lane, if it's on the
way). Nothing on the map is
anyone's, and nobody aims at it, but its old walls, hulks and columns stop
shots and block the way like any building, so they're cover for whoever gets
there first, and fire slowly knocks them down.

- *Old battlefield:* craters, junk and the burnt-out hulks of an earlier
  fight, picked clean long ago.
- *Fortified line:* a broken line of old walls and pillboxes across the
  middle, with gaps wide enough for a tank.
- *Crashed hulk:* the wreck of a giant machine at the end of the furrow it
  ploughed. Huge cover, and the scrap round it never runs out while it
  stands, so the scrap sides (Hive, Lodestar) feed on it.
- *Oil field:* derricks over pools of crude. A shell or flame bursting on a
  pool sets it alight, the fire running across it and burning everyone in it
  under a pall of black smoke, until it burns dry. A derrick blows up when
  it's destroyed and lights the pools round it, and while one stands the
  pools by it fill back up.
- *Geysers:* vents that blow steam every half minute or so, thick enough to
  throw everyone's shots off for a few seconds and to hide stealthy units.
- *Ancient ruins:* columns and broken temple walls on old paving. Soldiers in
  the ruins take half a burst that lands outside them, as in a trench.
- *Sacred grove:* a ring of giant trees round a clearing, with a few ways in.
  Vehicles go round it, only super units push the giants over, and the
  woodland sides' shots slip between the trunks.
- *Citadel:* an outpost near the middle walled in like a fortress, with four
  gates, a tower at each corner, two bunkers, a keep and twice the usual
  garrison. Whoever takes it gets +20% production.
- *Landing field:* an outpost on a paved apron with a flight tower. Its
  holder's aircraft, and a drop side's drops, come 35% faster. That's only
  the aircraft: a vehicle factory's scout drones come 35% faster, and its
  tanks no faster than before.
- *Rail line:* a railway across no-man's land between the sides, on a graded
  bed, through a town if one's in the way (its houses keep off the track).
  An outpost the track runs past becomes a station, and a new station goes
  a third of the way in from each end that has none, two in all. A minute
  after a side takes a station, an armoured train comes out onto the line
  for it, one train a side, and another a minute after it's lost. The train
  runs only on the track and takes no orders: it heads for the enemy nearest
  the line, stops to fight whatever's in range with its twin gun, and turns
  back at the ends and short of another train.
- *Tidal flats:* a sand bar across narrow water in no-man's land (two on a
  big map), under the sea as the map is made. Fifty seconds in, the tide
  goes out and uncovers it: a way across for foot, tracks and wheels (heavy
  going on the wet sand), and a wall to boats. A minute later the tide
  turns and comes back in over it for a minute, and so on, about every
  three minutes. Everyone's warned: a bar about to turn against a unit
  costs a lot to route over, so routes go round, and a unit on it gets off
  the shortest way. Land units still on it when the sea's over it drown,
  and boats over it when it dries run aground. Needs water: a dry map gets
  none, and a rolled map style only deals it (or a dam or a frozen lake) to a wet map.
- *Dam:* a low valley in no-man's land running down to the water, and up at
  its head a reservoir, its water standing higher than the sea, held back by
  a concrete dam across its mouth (where there's no room for a reservoir,
  the dam stands in the water off the valley's shore instead), with a
  *dam control* outpost (a sluice house) on high ground by it. If any stretch of the dam
  is shot to pieces, or the side holding the sluice house opens the sluices
  (it does, once, when at least five of its enemies are in the valley and
  at most one of its own), the valley floods from the dam outward in
  under a minute (the reservoir draining down into it) and stays flooded: routes over it are cut, and boats can get
  in. Ground the water's about to reach costs a lot to route over, a unit in
  its way drives out of the valley over dry land, and land units the water
  catches out of their depth drown. Needs water by low ground.
- *Frozen lake:* the most contested lake that doesn't reach the map's edge
  is frozen over: a way across for everyone. Each patch of ice takes strain
  from the weight on it (a soldier's nothing, a tank parked on it goes
  through in about half a minute, a super unit in seconds) and from fire
  and shells bursting on it, and gets over strain slowly. Too much and it
  gives way, cracking the ice round it, and land units out of their depth
  go through and drown. A hole freezes over again a minute and a half
  later, once it's empty. Tanks and walkers go round the ice where they
  can. Needs a lake.

A map style re-roll gives most maps a trait or two (the link key is
`traits=oil,ruins`).

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
  doctrine can turn up more than once. The first side of each doctrine wears
  its own faction (Cobalt Accord for Armour...); a repeat gets a made-up name
  and a colour picked to stand apart from the other sides and from the map's
  ground (Rust Cohort, Plum Levy...), drawn from the battle's seed. "Names"
  can make up an identity for every side instead. Sides you've named or
  coloured yourself keep theirs. The lock button on a side keeps it in every
  re-roll with its doctrine, name and colour (`lock3=1` in the link), so you
  can watch, say, Tidewater against a different doctrine each battle.
- **Dice and locks:** the re-roll buttons are presets over the settings
  further down, and each setting's row ends in a die (🎲) and, for settings
  a preset rolls, a lock (🔒). A preset lights up the dice of what it rolls
  (Map size: size and shape; Map style: terrain, water, hills, mountains, cliffs,
  dense forest, towns, town size and city; Biome: the biome). A lock keeps that setting as it is
  while the preset rolls the rest, so a map style, but always large and wet,
  is Map style and Map size on with Size and Water locked. A die rolls a
  setting on its own every battle, whether a preset covers it or not: a
  choice from all of them, on or off at even odds, or a slider between a
  low and a high you set under it. So the usual map, but any amount of
  water, is a die on Water with no preset. Nearly every setting has one, the
  unit caps and the tide too (`vlock=size,water` and
  `vdice=water:0.2-0.8,biome` in the link; see `game/rollables.ts`).
  "Clear dice and locks" takes them all off.
- **Explanations** of the settings sit behind a ? after each setting's name
  (or a section's), shown on hover or tap, so the setup screen is mostly the
  settings themselves.
- **Tournament** (Between battles, `tourney=1` in the link): pressing Start
  draws a knockout bracket of doctrines from the pool: Entrants of them
  (2 to 16, eight by default, `entrants=` in the link), each doctrine once
  while the pool lasts, then some again if the pool is smaller (the second
  as a made-up side of the same doctrine). A field that isn't 2, 4, 8 or 16
  gives some entrants a bye through the first round. They meet 1v1,
  knockout, each under its doctrine's own name and colour. The victory banner
  shows the bracket, with the winner put through and the next match marked,
  and the HUD names the match. After the final a new bracket is drawn. Map
  style, biome and size re-rolls still apply. A match that runs past Move on
  (15 minutes in Eternal, if Move on is off) goes to the side with the
  stronger army.
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
  **biome** (temperate, desert, snow, forest, jungle, steppe, tundra, ash
  wastes, scrapland or crystal fields: the ground's colours, the trees,
  rocks, junk or crystals, the water and sky, and the style towns are built
  in; looks only, nothing moves differently), a **town style** (the biome's
  own, or any of brick, adobe, alpine, timber, concrete, thatched stilt
  houses, shanty, yurts or domes, so a desert can have concrete towns),
  where the **bases** go (round the
  edge with allies side by side, round the edge with allies spread out, or
  teams in two lines facing each other), water and hills, and how many
  **towns** (none to four) and how big. Towns have districts: a harbour of
  warehouses on the waterfront, an industrial quarter, taller blocks in the
  centre, houses round them, and a paved main street; **roads** join the
  towns, along the easiest ground. **Townsfolk** (on by default, `folk=0`
  turns them off): a few people walk each town's streets, scattering from
  soldiers and vehicles that come near, and the town's own engineer puts
  up a new building every four minutes on the nearest open spot of its
  street grid, so a town grows outward over a long battle (to 1.6 times
  its radius). Nobody aims at a town, but stray fire wrecks it: once one
  side has razed three of a town's buildings, its people take up hunting
  rifles against that side as a **militia** (a faction of their own, see
  `militiaOf`), standing guard round the edge of town facing that side's
  base and shooting its units that come within nine units, and that side
  shoots back. They never go out to attack and leave other sides alone.
  Lost townsfolk come back one a minute from the town's buildings.
  Townsfolk count toward nothing: no caps, kills or strength. The end
  screen says how many town buildings and townsfolk were caught in the
  crossfire, and which sides the towns took up arms against.
  **City** (off by default; `city=1` for one town, `city=2` for the whole
  map): with **One town**, the first town is a city instead,
  as big as fits between the bases (about 35 by 50 units on a medium map,
  75 square on a large one; small maps have no room and keep a town),
  laid out square to the map's route grid (`world/city.ts`). Its blocks
  are rows of lots, one building filling each 3-unit lot (townhouses,
  apartment blocks, houses on the outskirts), with 1.5-unit alleys
  between them: infantry and the smallest vehicles slip down the alleys,
  everything else keeps to the 4.5-unit avenues, single file (the nav
  grid caps an alley cell's clearance at half a cell; a razed building
  opens its alleys up). The first outpost takes the city's paved square,
  and the city's engineer fills empty lots, the middle first. Some blocks
  are **parks** (clumps of dense forest) or **ponds**, and the odd lot a
  pocket park; a lot's `use` is where more kinds (a city's vehicle depot,
  say) would go. With **Whole map**, one city covers the map instead of
  any towns: blocks wherever the ground is dry and gentle enough, kept
  off the base pads and bridges, each block levelled so hills become
  terraces with the avenues ramping between them.
  The square sits on a random corner of the central crossing. A city's
  central avenues run on past its edge, narrowing to a town street's
  width where country roads join them. Re-rolled map styles include
  **Metropolis** (a city over the whole map); other styles with towns
  make the first one a city 30% of the time (`CITY_ODDS`). For sims,
  `--maps` takes `city` and `metropolis`.
  **Waterways** (on by
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
  **Wildfire** (a slider, off by default): fire that gets going in dense
  forest (a flamer's, a burning wreck's, a burning oil pool's) catches the
  trees. A stand burns for about half a minute under a pall of smoke that
  throws shots off, creeping slowly on to the stands beside it (faster the
  higher the slider, and in dry country: desert, steppe and ash burn
  readily, jungle, snow and tundra barely), then the trees lie charred on
  burnt ground, a little rough going. It's nobody's fire, so it burns
  everyone in it. Ground burning with nobody's fire (a wildfire, a burning
  oil field) costs a lot to route through, so units go round it, and one
  caught in it gets out the shortest way.
  **Bridges fall** (off by default): a map bridge takes a lot of punishment
  but wears down under every shot that bursts on it or by it, whoever fired
  it, and under heavy fire it comes down for good, taking whatever's on it
  into the water. The crossing is cut, so routes go round, and the sides'
  engineers bridge it again if the way round is long.
  **Scrap** (on by default): where enough vehicles are wrecked, the ground
  turns to scrap, a slog for tracks and hovers and easy for long legs,
  until it's cleared away four minutes later. **Wreckage:** a destroyed
  vehicle's hulk stays on the field two and a half times as long as it
  used to (a tank's about a minute), then falls apart over 20 seconds: its parts drop off
  onto the ground, lie there a while and sink away one at a time, small
  ones first and the bare hull last, while the junk heap grows up round
  it. Some junk is thrown about as it's destroyed, too. The junk is drawn
  as heaps of plates, sloped wedges, track lengths, road wheels, girders,
  gun barrels, drums and mangled lumps, charred and grey, with about half
  the pieces keeping the darkened colours of the sides whose vehicles died
  there. A heap is a clump for one wreck and a mound where many fell
  (neighbouring spots blend into one heap), spilling outward once a spot
  is full, so the places fought over most turn into scrapyards. It rusts
  away over minutes, a lone wreck's scattering much sooner than a heap
  (a lone tank's in about four, a big heap a quarter of an hour or more),
  so what lasts is the piles from the big fights rather than an even
  coating; its top pieces sink into the ground as it goes, each at its
  own pace. **Wreckage** and **Wreckage lasts** (100% and 1×) scale how
  much junk a wreck leaves (None for none) and how long it lasts; the
  hulks fall apart the same either way. It's kept in the sim
  (`game/wreckage.ts`) for doctrines that will feed on it, and the heaps
  shrink a piece at a time as it's taken. It gets in nobody's way: the
  scrap ground does that. **Craters** (on by default):
  a super unit blowing up leaves a small crater with a rim of churned
  earth (a shot-down airship, where it hits the ground), so a front that's
  been fought over for an hour is worn down and pocked. On low ground a
  crater goes below the water and floods, so long battles by a lake or
  river slowly turn the ground there to ponds; engineers fill them in
  where they cut the way across (see Engineers).
- **Placement:** a map of the battle the settings make, on the setup
  screen, where the bases, towns and outposts can be dragged to new spots.
  Dropping one fixes where every one of its kind goes (kept in the link as
  `bpos`, `tpos` and `opos`); the map is generated round them. Changing the
  number of sides, towns or outposts, or the base layout, goes back to
  automatic placement for that kind.
- **Doctrines:** what kind of army a side fields, picked freely per side
  (each faction slot has a default: Cobalt Armour, Crimson Raiders, Ashen
  Legion, Gilded Bastion, Violet Talon, Ivory Skyline, Teal Tidewater,
  Ember Firestorm; Aegis, Rime, Sabre, Cipher and Veil have no slot of their own, and wear
  Verdant Protectorate, Celeste Dominion, Onyx Order, Magenta Directive and Obsidian Choir colours). Every doctrine fields rifle squads with AT troopers,
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
    from the factory; 1.7× infantry cap, 0.8× vehicles. Its engineers dig
    trenches with an earth berm in front, which its massing squads man,
    and put up a pair of walls out in front of each (a gap between for the
    trench's fire) to draw the enemy's.
    Super unit: the
    Siege Crawler, slow heavy mortars that drops off a squad every 40
    seconds.
  - *Skyline:* gunships, bombers, strike jets and scout copters from its
    **airpad**, battle tanks and flak walkers from the factory; 2.5× air
    cap, 0.8× infantry and vehicles. Bombers and jets are planes: they
    never stop, circling where they were sent when there's nothing to do
    and attacking in runs straight over the target. Gunships, bombers and
    jets carry so many shots, then fly back to the airpad to rearm
    (gunships set down on it), or to a **forward helipad** its engineers
    put up behind an outpost it holds out toward the enemy (two at most).
    Every aircraft banks into its turns, and a
    shot-down one flies on as it falls and explodes where it hits.
    Super unit: the Airship Carrier, a slow armoured airship that launches drones.
  - *Bastion:* howitzers (its signature unit), railgun batteries (long,
    flat, armour-piercing shots), battle tanks and flak tanks, a **sensor
    mast** and two extra guard towers; 1.1× vehicles. Howitzers and
    railguns shoot further than their crews can see; inside the mast's
    30-unit radius, the Fortress Walker's 26, or 14 round any of its scout
    copters, they fire at their full range. Its engineers put up **comms
    arrays** at the front, which spot for the guns like a small mast (22
    units). Super unit: the Fortress Walker.
    *Bastion (spider test)*, under "Test" in a side's doctrine list and
    nowhere by default, swaps it for the Siege Spider: a giant
    eight-legged howitzer that spots for itself and climbs over buildings.
  - *Talon:* packs of three striders, spider walkers (which take any slope
    as easily as flat ground, climb straight over buildings and walls,
    and shoot at aircraft) and Warhound heavy walkers from the factory and a **mech
    forge**; 1.05× vehicles, 0.8× infantry. Super unit: the Juggernaut.
  - *Tidewater:* skimmer hover tanks, amphibious transports (which carry a
    squad) and battle tanks from the factory; 1.35× vehicles, 0.8×
    infantry. A **dock** on the nearest shore launches missile boats (and
    only boats), if there's open water within reach of the base (on the
    default maps there usually isn't; from 0.6 water up, waterways give
    every base some). Boats don't count against the vehicle cap: a side
    has six berths (times its team boost). Without a coast it starts with
    a **hover pad** that turns out skimmers instead. Its engineers build
    whichever of the two the base lacks (a dock on a shore a little
    further out, or on a harbour basin they dig by the base when the map
    has no boat-deep water at all), before anything else, and dig canals
    out toward the enemy so the boats can reach it. Boats can't take outposts or
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
  - *Aegis:* energy domes (`game/shields.ts`). Tanks, lance walkers, dome
    trucks and flak tanks from the factory; a **shield works** turns out
    more and keeps a big dome over the base. A dome is a sphere round
    its emitter, reaching down to the ground on a slope: shots and missiles from outside burst on its skin and it
    soaks up their damage until it collapses, then comes back after a
    while at a third of its strength. Shots from inside go out freely, and
    lobbed shells and flame fall straight through, so artillery and
    flamers crack an Aegis push. Dome trucks trail the tanks they cover;
    lance walkers' beams pierce armour and drain enemy domes fast. Super
    unit: the Citadel, a walker under a dome of its own.
  - *Rime:* frost (`game/frost.ts`). Cryo troopers in the squads, shard
    tanks and freezer trucks (which lob frost canisters) from the factory,
    and a **cryo plant** that keeps the ground round the base frozen.
    Frost turns the ground white and slows enemies of whoever laid it to
    as little as half speed, on water too; it thaws on its own and fire
    melts it at once. Shard guns frost a little of what they hit, and do
    1.8× to anything standing on frost, so follow-up shots shatter it.
    Its engineers throw ice bridges: quicker to put up, more of them, but
    they melt away sooner and flame melts them fast. Super unit: the
    Glacier, a walker that freezes the ground round it.
  - *Sabre:* melee mechs. Small squads of riflemen (0.55× infantry cap)
    and many more mechs: **duelists**, quick little blade striders that
    each take half a vehicle slot, come from the factory and from its
    **duel hall** in fours; **reavers**, heavy tanks whose turret is a
    great axe arm, take one and a
    half, smash their way into tanks. Every mech fights hand to hand with
    its main weapon but carries a gun on a mount of its own (duelists an
    arm cannon, reavers a hull machine gun), so it isn't helpless across a
    river or at a crossing it can't reach. Super unit: the Colossus, a
    giant whose hammer fists sweep everything round it and whose rocket
    rack reaches aircraft.
  - *Cipher:* hacking (`game/hacking.ts`). Hack vans lock on to an
    enemy vehicle and turn it to Cipher's side for six seconds: it stops
    dead and fights whatever is round it, its old friends included (and
    they it), then comes back to itself and can't be turned again for
    twelve. Kills it makes while turned are Cipher's; if it dies turned, it
    dies as its own side's. Infantry, super units, carriers and engineers
    can't be hacked. Pairs of **drone operators** come out of its
    barracks: each sends up a drone when it meets the enemy (a carrier of
    one, `UnitDef.carries`) and readies another a minute later, and the drones
    hunt the infantry, the AT troopers that crowd a hacked vehicle
    included. Jammer walkers send out a pulse every few seconds out to
    fourteen units: enemy guns it reaches reload at 0.6× until the next,
    shown as a faint hexagon on the ground under each jammed unit. Its
    **uplink mast** turns out more and jams what comes at the base. Super
    unit: the Overmind, a walker with a hack array and a rack of three
    drones on its back.
  - *Veil:* haze and stealth (`game/smoke.ts`). Smoke trucks lob
    canisters that leave a thin, low haze, and its **smoke stacks** keep
    one over the base. The haze hides nothing, but a shot whose line runs
    through another side's haze picks up extra spread (up to 0.35, at three
    units of haze), so shots into it and out of it scatter round their
    targets and miss a lot; Veil shoots through its own as if it were
    clear. Its only infantry are shades, AT troopers that vanish while they
    hold their fire in a forest, by a building or in Veil's haze, moving or
    not; ghost tanks fade a few
    seconds after each shot. Firing gives a shade away for two seconds,
    a ghost tank for three.
    Spotters (guard towers, Bastion's scout copters, comms arrays) see
    stealthed units in their radius. Stealthed units are drawn faint and
    see-through. Its factory turns out ghost tanks in place of plain ones,
    and strike jets in place of scout copters. Super unit: the Eclipse, a
    walker breathing out haze over the army that walks with it.
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
  the side's doctrine. Most units take one slot; a unit can take less or
  more (`UnitDef.capCost`: a duelist takes half, a reaver one and a half),
  still out of the one shared vehicle pool, so the survivors of a long
  battle still drift towards its stronger units. A full category stops its own production but not
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
- **King of the hill:** Conquest's rules plus one more outpost, the hill,
  on the fairest ground near the middle (about as far from every base; towns
  keep off it). It's bare ground round a tall beacon in its middle (the
  hill's post) flying its holder's banner, with no towers or guards, so whoever takes it has to hold it with
  their army. Attacks go for the hill instead of the enemy base, and a team
  that holds it keeps its army there between attacks. The holder's clock
  runs while no enemy is within a few units of the ring; the first team to
  hold it for **Hold to win** (5 minutes by default) in all wins. A bar at
  the top shows each team's time left, and the ticker calls the last minute
  and the last 30 seconds. The nearer the holder is to winning, the smaller
  the edge (and the army) the others wait for before going in. Near the
  end, once the holder is about as close to winning as the others' army is
  from the hill (plus 25 seconds), they go **all in**: everything they have
  sets out at once, nobody stays to hold other outposts or goes home to
  regroup, and they keep at it until the clock is stopped, so a match ends
  in one big last fight rather than a standoff. The ticker calls it. (The
  holder walking round the hill isn't an attack on anyone's base, so
  nobody stays home for it.)

**Controls:** WASD / arrows or right-drag to pan, wheel to zoom, Q / E to
rotate, F follows the fighting, V the director camera, U the unit camera, T toggles tilt-shift, G opens the god powers,
H opens photo mode, space pauses, 1-4 set speed, Esc cancels.

The **Battle controls** panel (top right) sets speed and camera effects.
The **camera** buttons pick who moves the camera. **Free** is you.
**Follow** (F) glides to wherever the biggest fight is. **Director** (V)
works like a sports broadcast: every second it scores each fight by its
hits, kills, buildings under fire and super units, and by how even it is
(an even fight beats a rout). It holds a shot at least 14 seconds and cuts
only to a fight nearly twice as good, or early for a super unit dying or
an HQ falling. Each shot centres on the gap between the two sides' fronts
and looks across it, so one army is on the left and the other on the
right, zoomed in as close as fits them. On a cut it keeps the angle it had
if that's near enough, rather than swinging round for every new fight. It
turns a little either way to put a hill's crest up the screen, so you see
units climbing it on the left and right, rather than across the screen,
where it hides what's behind; it comes down low to show the slopes in
profile, and goes higher where hills, dense forest or buildings would hide
the fight from low down. Then it stays put: it doesn't turn while a shot
lasts (unless one army comes right round in front of the other), moves
only if the fight drifts well off centre, and zooms only if it outgrows
the picture or shrinks well inside it. It glides between shots, rising
for far jumps; it never cuts or fades. **Unit** (U) rides with one unit:
the one you clicked, or a strong one in the director's fight. It looks
from behind the unit, a little to one side (further round if a hill, trees
or a building would block the view), toward what it's doing: its target,
or where it's headed, or just ahead of it. The unit sits in the bottom
quarter or so of the picture, with what it's doing up the screen ahead.
When it dies the camera stays on the wreck for 3 seconds, then picks another
unit nearby; click a unit to ride
with it instead, Esc to stop. Panning by hand gives the camera back to
you. **Shadows**
High / Low / Off trades looks for speed in huge battles; shadows are only
drawn around the part of the map in view either way. **Resolution**
Full / ¾ / ½ draws the battle with fewer pixels and scales it up, for big
or high-DPI screens and slower GPUs. These are remembered
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
fuel depot in the north", "on a bridge", "outside Crimson Brigade's base"),
production buildings razed, attacks setting out, sides knocked out.
**Commander voices** (chips under the ticker checkbox, off by default) let
the Commanders of the sides you pick speak in the ticker as their plans
change, each in its doctrine's manner: setting out ("Floor it, lads,
Cobalt Accord won't know what hit them!"), pulling back, defending the base,
taking an outpost, sending a gun hunt, losing the super unit. A voice line
takes the place of the plain line for that side, and a Commander keeps
quiet for 15 seconds after speaking (except when its base is attacked or
its super unit falls). Picks are kept by side name, so they carry over
between battles. **Show front lines** shades the ground in the colour of whoever holds it, from
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
with the most kills on any side, with the army strength of what it killed
(so a tank counts for more than a rifleman). Side names and chart lines in
dark colours are lifted toward white so they read on the dark panels.

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
    moveClasses.ts   movement classes (foot, tracked, wheeled, walker, climber, hover, amphibious, naval, air) and their terrain rules
    navGrid.ts       route-planning grid per movement class (terrain, slopes, towns, buildings) and A*
  game/      simulation
    components.ts    component definitions (Transform, Mover, Armed, ...)
    units.ts         unit and weapon definitions (stats are data)
    buildings.ts     building definitions: production, defences, civic
    spawn.ts         assembles unit and building entities from definitions
    mounts.ts        where each armed model's turret, barrel pivot and muzzles are, shared by the sim and the models
    tide.ts          production tide, the tide's attack clock, and the ramps
    offensive.ts     when each team attacks: readiness, or the tide's clock
    commander/       each side's planner above the squads (see "The Commander" below)
      commander.ts     each side's picture of the battle (army, strength, make-up, enemies' make-up) and its goals
      strength.ts      strength map: each side's fighting strength per 6-unit cell, on the ground, in the air and against aircraft
      places.ts        the map's key places: bases, outposts, towns, bridges, narrow crossings and high ground
      taskForces.ts    squads sent off between attacks to take outposts or save the side's own
      advice.ts        production advice (leaning each doctrine's table toward what the battle needs) and per-side styles
      crossings.ts     whether there's still a way across wide enough for super units, and where it's cut
      roles.ts         jobs that suit the unit: flak covering against aircraft, artillery on high ground, escorts for super units
    lanes.ts         attack routes (centre, and through traits, outposts and towns) and which squad takes which
    outposts.ts      capturable outposts: their kinds, garrisons, capturing, bonuses
    hill.ts          king of the hill: the hill's clock and who's winning on it
    tournament.ts    tournament mode: the bracket, its matches and their settings
    towns.ts         townsfolk: people in the towns, the town engineer who grows each one, and the militia
    scrap.ts         wreckage piling up into scrap, and being cleared
    wreckage.ts      the junk wrecks leave on the ground, rusting away (and taken by doctrines that use it)
    craters.ts       craters where super units blow up
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
    director.ts      the director camera (scores and frames fights) and the unit camera
    tiltShift.ts     tilt-shift blur + colour grade passes (the last also writes the screen)
    renderProfile.ts page and GPU time per part of a frame, for P and npm run fps
    upload.ts        send only the used part of instance buffers to the GPU
    terrainMesh.ts   low-poly ground, soil skirt, water, bridges and road strips (merged per map square); redraws cells the map changes
    woodsMesh.ts     the dense forest's trees, lying down where they've fallen, in map squares
    propsMesh.ts     instanced scenery, and the trees' near, far and shadow shapes
    plantLod.ts      near and far tree shapes by zoom, and their shadow stand-ins
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
    perfOverlay.ts   render and sim stats readout, hitch log and cost check (P)
    ticker.ts        the battle ticker's feed
    voices.ts        Commander voices: each doctrine's lines for the ticker
    hillBar.ts       king of the hill's scoreboard: each team's time left on the hill
    bracketCard.ts   the tournament bracket shown between battles
    battleChart.ts   army strength through the battle, for the end-of-battle chart
    photoMode.ts     photo mode (H): no interface, free camera, time of day, save a picture
    debugPanel.ts    the debug overlays' switches (O)
    settingsUrl.ts   settings <-> URL query string (only non-default values)
    viewPrefs.ts     display preferences (shadows, follow) kept in this browser
    dom.ts           small DOM helpers
  sim/
    simulate.ts      headless balance scenarios and stats (npm run sims; scripts/sims.mjs runs them)
    duel.ts          unit-against-unit duels on open ground (npm run sims -- --duel)
    trace.ts         a battle replayed from its link, with each Commander's plans (npm run sims -- --trace)
    bench.ts         fixed battles timed for npm run bench, with result fingerprints
    mapTool.ts       settings and pictures for npm run map (scripts/map.mjs)
    mirror.ts        the worker's battle copied onto the page's view of it, frame by frame
    simWorker.ts     the Web Worker that plays the battle
    remoteSim.ts     the page's end of the worker: asks for ticks, applies frames
  app.ts     session flow: one renderer and loop, a battle at a time, setup in between
```

### Guns, muzzles and slopes

Every armed model with guns has a **mount** in `game/mounts.ts`: where its
turret turns, where its barrels pitch, and where each muzzle is. Shots,
muzzle flashes and smoke leave from the muzzle, and the models in
`render/models` are built round the same points (`test/mounts.test.ts`
poses every model and checks its muzzles are where the sim fires from, at
the end of a barrel). With several barrels, a burst takes turns along them
(a tower's twin guns go left, right, left) or, with `salvo: 'together'`,
fires them all at once (the Fortress Walker's siege guns, the
Dreadnought's broadside, flame lances).

Tanks, trucks and hovers **lie along the ground** (`systems/tilt.ts`): a
plane through the ground on a ring round the hull gives its pitch and
roll, so it noses up a hill and leans along the side of one without
rocking over every bump or teetering on a peak narrower than itself, and
it rides on the rims of a dip rather than sinking into them. Walkers keep
their bodies level. Turrets turn on the tilted deck and barrels pitch
toward their target within the mount's limits: a tank perched above a
soldier at the foot of a slope can't dip its gun that far, so it holds
fire and moves to where it can (`elevationFor`, and the firing spots in
`systems/targeting.ts`). Lobbed weapons raise their barrels and racks
further the further they're shooting.

### More than one weapon, and melee

A unit (or building) has one **main weapon** (`UnitDef.weapon`, the `Armed`
component) and can carry more on **mounts of their own**
(`UnitDef.mounts`, the `Arsenal` component): a tank's roof machine gun, a
walker's flak pod, a mech's claw. Each picks its own target, turns its own
turret (its own entry in `game/mounts.ts`, which the model builds as
`rig.mounts`), pitches its own barrels and keeps its own cooldown, so a
tank can shell a tank with its cannon while its machine gun works on the
infantry round it. Only the main weapon steers the unit: what it chases,
where it stands and which way a turret-less hull turns. A fixed weapon on
a mount of its own fires when the hull happens to face its target.
`game/arsenal.ts` goes over all of a unit's weapons for everything that
asks "is it fighting", "how strong is it" or "can it shoot aircraft"
(strength, the Commander's threat map and production advice, alertness,
healing, stats).

A weapon with `melee` (`MeleeDef`) is a **melee weapon**
(`systems/melee.ts`): it fires no projectile but lands a blow on what it's
touching. Its reach runs from the striker's own edge, so melee units close
to contact and keep pressing in, and go straight at enemies rather than
steering round them. All of it is physical: a `lunge` bounds the last
stretch in, a `knock` shoves the struck back (small things further than
big ones), a `sweep` catches enemies either side of the target too, and a
`charge` runs at a target it can see but not yet reach. The Commander
calls **charges** (`commander/charges.ts`): a melee squad with an enemy
group just past its sight, and the strength to take it, goes for it as a
squad, at a run, rather than waiting for it to walk into reach. The
`struck` event draws the blow: the body jabs forward, the model swings
(`rig.strike`), sparks fly the way it swung and a stomp kicks up dust.
Sabre's mechs use both.

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
  and mechs find them dear, and walkers take slopes easily. Wheeled
  vehicles (trucks, buggies, carts) are tanks' quicker, fussier cousins:
  faster on roads, but slower up steep ground and through rough ground,
  and routes take them further round both. A straight line
  to the goal is only taken if it keeps to plain ground, and route
  smoothing never shortcuts across ground the route went round, so the
  costs show up as routes. A goal a class can't get to at all (a boat
  sent inland, or across a lake with no way round) becomes the nearest spot it can
  reach (`NavGrid.nearestInRegion`). The **ground layer** (`world/ground.ts`)
  adds a cost and a speed per class on top: roads are a little quicker for
  tracks and a good deal quicker for wheels, scrap is a slog for tanks and hovers but easy for long
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
  vehicle, super) and counts `capCost(def)` (default 1) against that cap; ask `canBuild` before
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
  towers. A guard tower's cannon switches to an armour-piercing shell
  against tanks and other heavily armoured targets. What each building turns out depends on the doctrine. Infantry come in squads of riflemen
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
  them. They fortify with lines of wall segments, each with a field tower
  (a guard tower; at most two per side) just behind it: across a choke
  point on the enemy's way in that suits the doctrine (a valley between
  steep slopes for Talon, a neck of land between waters for Tidewater;
  other doctrines only wall a choke close to home), in front of outposts
  held out toward the enemy, behind the army while it pushes forward, and
  in front of the rally points. With nothing to build they follow a push,
  so the next line goes up where the front now is. A wall stops shots like
  any building, so it's cover, and attackers have to go round it or knock
  it down. Walls crumble over ten minutes and towers over fifteen; neither
  is rebuilt (no rubble), they don't count as production in Conquest, and
  a side has at most ten wall segments standing. Doctrine jobs: Legion
  digs trench lines with a berm instead of walls (soldiers in a trench
  stand up to shoot over the berm, shots at them from afar mostly hit it,
  and bursts outside reach them halved), Bastion builds comms arrays, and
  Tidewater builds a missing dock or hover pad and digs canals of
  boat-deep water a few metres at a time (never one that cuts a base off
  by land; with no boat-deep water anywhere near, they dig a harbour
  basin by the base for the dock). The base's missing dock or pad, and
  digging toward it, come before any other job, whichever engineer is
  nearest. Legion also puts a pair of walls out in front of each trench
  line, and Skyline puts up forward helipads behind outposts it holds,
  where its aircraft rearm. Everyone else throws timber bridges across an
  enemy Tidewater's canals where one cuts the land way to the enemy to
  80% or less (two at most per side): a bridge comes down after ten
  minutes, or when enemy shells landing on it have done 600 damage, and
  anything on it goes in the water. Engineers don't build where an enemy
  unit is within 14 units, take no cap, never join an attack or a task
  force; the rally flag and stances pause their work. Every side's
  engineers also keep a way open across the map (`crossings.ts`): when
  there's no way from the base to the nearest enemy's at least 2.2 units
  from water all the way (room for a super unit), because craters have
  flooded it, a god power's Lower Land has cut it, or anything else, they
  throw a timber bridge over the gap if it's short enough and raise the
  ground in it with earth, a few metres at a time, until there's a way
  again; that comes before every other job. Any water the battle made is
  filled however deep (a deep hole fills faster while it's deep, so a
  three-metre trench takes a few minutes); of the map's own water only
  shallows up to half a unit deep, never a lake, the sea, a river or a
  canal. Timber bridges don't count as a way across, so the gap under one
  still gets filled. Each side picks where to cross for itself: where
  filling costs least once enemy units near it (and enemy bases) are
  added, and its own units near it taken off, looked at again every 20
  seconds, so its engineers work away from the enemy's armies and two
  sides cutting across the same water mostly do it in different places.
  Engineers at work on a crossing and the other side's engineers don't
  shoot one another. Engineers with
  nothing to build **repair** their side's land vehicles that are out of
  the fighting (below 97% health, not hit for ten seconds, no enemy within
  14 units): they walk over and patch it up at 0.8% of its health a second
  (2.5 at least), with welding sparks. Bridge repairs are still to come.
- **Hunting the guns** (`game/commander/hunts.ts`, *Gun hunts* under
  Armies, on by default). A howitzer, rocket truck or other long-range
  artillery shelling a side from beyond its reach gets hunted: the side's
  Commander sends its quickest squads (up to 30% of its army, enough to
  beat what's guarding the gun) to kill it. If the enemy's army stands
  between them and the gun, they swing out round the quieter side first
  and come at it from the flank, not stopping to fight on the way; then
  they charge the gun and shoot it before anything else in reach. One hunt
  per side at a time; it ends when the gun dies, the hunters are spent, or
  after two and a half minutes. The plans overlay draws it as an arrow
  round the flank to the gun.
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
  turns it off (URL `avoid=0`). Enemy boats count as a counter of their
  own to anything on land (a shore they cover is ground a land squad can
  be shelled on without closing with what's shelling it): their danger
  counts in full, so squads march inland of shores the boats are working.
- **Shortcuts over water** (`game/commander/shortcuts.ts`, *Bridge
  shortcuts over water* under Armies, URL `span=0` turns it off). Every
  side but Tidewater looks along the shores for water 3 to 18 m wide that
  a timber bridge could span, and weighs each place by how much shorter
  it makes the way from its rally point to the enemy base and to the four
  nearest outposts it doesn't hold (an island no land unit could reach
  counts for a lot), less where enemy units are about. The best place is
  an urgent job for an engineer, even out past the front and even where
  there's a way round already; it can be shot off the job, and the
  bridge shelled down. Up to two shortcuts a side (three bridges in all).
- **Shore batteries** (`game/commander/engineers.ts`). A land side
  (everyone but Tidewater) remembers, for five minutes, where on its own
  part of the map enemy boats have fired on it from. Once it's quiet there
  (no enemy, boats included, within 26 units), an engineer puts up a shore
  battery on the first dry ground toward home, facing the water: a squat,
  twin-barrelled gun (range 24, 42 a shot) waiting for the next time the
  boats come. It crumbles in 15 minutes like the walls. Up to three a side.
- **Not pinned by boats** (`game/offensive.ts`). A base under attack
  only from the water (at least 60% of the enemy strength near it
  afloat) doesn't keep its army home: the side goes on massing and hits
  back at the enemy's base, which is on land.
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
  bunker then switch sides. Each outpost is one of ten kinds
  (`OUTPOST_KINDS`; the setup screen picks which the map deals out), with
  a building of its own and a bonus for its holder (`OutpostBonus`; the
  Outposts bonus setting scales it): a *supply depot* (+10% production), an
  *airstrip* (+2 aircraft cap), a *hilltop gun* (a long-range gun on the
  highest outpost, firing for whoever holds it), a *comms relay* (the
  holder's team grows impatient 40% faster while massing, so its attacks
  set out sooner, and the mast spots for its guns), a *fuel depot* (+10%
  production, and its tanks blow up) and a *ruined factory* (turns out one
  of the holder's factory batches every 75 seconds). Five more are off by
  default, so the usual battles stay as they were: a *shipyard* (dealt to
  the outpost with the most water by it, it launches a missile boat for its
  holder every 80 seconds, two afloat at most, even for a side with no
  navy), a *sensor station* (a wide spotting ring that picks out stealthy
  units for its holder's team), a *repair yard* (mends the holder's team's
  vehicles and walkers that come by it, about 2.5% a second, and units that
  fall back to mend use it) and a *signal fire* (every two minutes a relief
  column of three of the holder's wave picks marches in from the nearest map
  edge). A fifth, the *drawbridge* (dealt only to an outpost within 20 of a
  map bridge, one per bridge), works that bridge for its holder: it swings
  up, hinged at the end by the drawbridge house, when the holder's enemies come near it and nobody's on it, so they can't
  cross there, and comes down again once they've gone; held by its garrison
  it stays down. The clock on a shipyard or signal fire starts again when it changes
  hands, so taking one doesn't pay out at once. Every outpost makes
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
    build walls; then doctrine engineering: choke-point walls, comms
    arrays, trenches and berms, docks, hover pads and canals. Next:
    engineers that repair bridges; then aircraft that fly like planes.
