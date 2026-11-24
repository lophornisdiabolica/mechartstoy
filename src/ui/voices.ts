import { canonicalDoctrine, DoctrineId } from '../game/doctrines';

/**
 * Commander voices for the battle ticker: a line from a side's Commander,
 * in its doctrine's manner, when its plan changes. They're flavour only,
 * picked from the lines below; `{enemy}`, `{where}` and `{unit}` are filled
 * in with the side it's going for, a place and a unit's name.
 */

/** What a Commander has just decided, or just had happen to it. */
export type VoiceMoment =
  /** Its team sets out to attack {enemy} (or, in king of the hill, for {where}: the hill). */
  | 'attack'
  /** The attack is spent: pulling back to regroup. */
  | 'regroup'
  /** Its base is under attack, so the army stays home. */
  | 'defend'
  /** It took an outpost ({where}). */
  | 'took'
  /** It sends squads to hunt a long-range gun ({unit}). */
  | 'hunt'
  /** It lost its super unit ({unit}). */
  | 'lost';

export const VOICE_MOMENTS: VoiceMoment[] = ['attack', 'regroup', 'defend', 'took', 'hunt', 'lost'];

type Lines = Record<VoiceMoment, string[]>;

const VOICES: Partial<Record<DoctrineId, Lines>> = {
  armour: {
    attack: ['All units, advance on {enemy}. Move out.', 'Orders are in: we take the fight to {enemy}. Go.'],
    regroup: ['Fall back and reorganise. Casualty reports on my desk.', 'Pull back to the start line. Resupply and stand by.'],
    defend: ['Contact at the base. All companies, return and hold.', 'They’re at the wire. Every unit back to defend HQ.'],
    took: ['Objective {where} secured.', '{where} is ours. Consolidate and hold.'],
    hunt: ['Enemy {unit} spotted. Detach a section to deal with it.', 'That {unit} is a priority target. Take it out.'],
    lost: ['We’ve lost the {unit}. Close up and carry on.', 'The {unit} is down. Stick to the plan.'],
  },
  raiders: {
    attack: ['Floor it, lads, {enemy} won’t know what hit them!', 'Everyone in the trucks! We’re paying {enemy} a visit.'],
    regroup: ['Scatter and meet back at the motor pool!', 'Leg it! Regroup at the trucks.'],
    defend: ['They’re in our yard! Grab whatever shoots!', 'Back home, quick, before they nick the trucks!'],
    took: ['{where}’s ours now. Strip it for parts!', 'Grabbed {where}. Finders keepers.'],
    hunt: ['There’s a {unit} lobbing shells at us. Go fetch it.', 'Buggies! Run down that {unit}.'],
    lost: ['Lost the {unit}. Plenty more where that came from.', 'The {unit}’s scrap. Steal another.'],
  },
  legion: {
    attack: ['Forward, the Legion! March on {enemy}.', 'Shields up, ranks closed. We march on {enemy}.'],
    regroup: ['Back to the trenches. Re-form the ranks.', 'Withdraw in order. The Legion does not run.'],
    defend: ['To the berms! Every squad to the walls.', 'They come to us. Let them break on the trenches.'],
    took: ['{where} is taken. Dig in and hold.', 'Raise the standard over {where}.'],
    hunt: ['A {unit} harries the line. Send a cohort.', 'Find the {unit}. Take it with bayonets.'],
    lost: ['The {unit} has fallen. The Legion endures.', 'We lost the {unit}. Fill the gap.'],
  },
  skyline: {
    attack: ['All wings up. Target: {enemy}.', 'Wheels up. We hit {enemy} from above.'],
    regroup: ['Return to the pads and rearm.', 'Break off. Back to base, refuel, go again.'],
    defend: ['Bandits over the base! Scramble everything.', 'Cover the pads. Nobody lands on our home.'],
    took: ['{where} secured. Set up a landing zone.', 'We hold {where}. Good spot for a helipad.'],
    hunt: ['Gun on the ground: a {unit}. Gunships, go.', 'Strike package on that {unit}.'],
    lost: ['The {unit} is down. Repeat, the {unit} is down.', 'Lost the {unit}. Keep the sky.'],
  },
  bastion: {
    attack: ['Guns are ranged on {enemy}. Advance behind the barrage.', 'Walk the shells forward. Infantry follow onto {enemy}.'],
    regroup: ['Back under the guns. Let them come to us.', 'Withdraw behind the batteries and reload.'],
    defend: ['Enemy in the zone. All batteries, fire for effect.', 'The fortress holds. Bring every gun to bear.'],
    took: ['{where} taken. Run a line to the batteries.', '{where} is ours. Spot for the guns from there.'],
    hunt: ['Counter-battery: a {unit}. Send the fast column.', 'Their {unit} is outranging us. Find it.'],
    lost: ['The {unit} has fallen. The guns go on.', 'We lost the {unit}. Fortify.'],
  },
  talon: {
    attack: ['The pack hunts. Walkers, on {enemy}.', 'Striders out. We stalk {enemy}.'],
    regroup: ['Back to the forge. Lick the wounds.', 'The pack falls back. Mend the legs.'],
    defend: ['Something’s in our den. Turn and bite.', 'Walkers home. Guard the forge.'],
    took: ['{where} is ours. Mark it.', 'Took {where}. The pack rests there.'],
    hunt: ['Smell that {unit}? Spiders, over the hills and get it.', 'Hunt the {unit}. Take the high ground to it.'],
    lost: ['The {unit} has fallen. The pack goes on.', 'Lost the {unit}. Howl later, fight now.'],
  },
  tidewater: {
    attack: ['Make way for {enemy}. Full ahead.', 'All hands, we sail on {enemy}.'],
    regroup: ['Come about, back to the docks.', 'Fall back to harbour and repair.'],
    defend: ['Enemy at the harbour. Man the guns!', 'Hold the docks. Every boat to the quay.'],
    took: ['{where} is ours. Mind the tides.', 'Took {where}. Good anchorage.'],
    hunt: ['A {unit} is shelling us. Hovers, run it down.', 'Find that {unit}, even if it’s ashore.'],
    lost: ['The {unit} is lost. Colours at half mast.', 'We lost the {unit}. Steady as she goes.'],
  },
  firestorm: {
    attack: ['Light them up. Burn a road to {enemy}.', 'Torches on. {enemy} burns tonight.'],
    regroup: ['Back to the depot. Top up the tanks.', 'Let it burn down. Pull back and refuel.'],
    defend: ['They’re at the fuel depot! Keep them off it!', 'Fire on our own doorstep. Hose them down.'],
    took: ['{where} is ours. Mind where you point those.', 'Took {where}. Smells of smoke already.'],
    hunt: ['A {unit} out there. Scorch buggies, go cook it.', 'Burn out that {unit}.'],
    lost: ['The {unit} burnt out. Light another.', 'We lost the {unit}. Fan the flames.'],
  },
  aegis: {
    attack: ['Domes up. We advance on {enemy} under the shield.', 'Shields forward. Lances ready for {enemy}.'],
    regroup: ['Back under the big dome. Let the shields recharge.', 'Withdraw and recharge the domes.'],
    defend: ['Everyone under the dome! Hold position.', 'The base dome holds. Lances to the gate.'],
    took: ['{where} is ours. Throw a dome over it.', 'We hold {where}. Shield it.'],
    hunt: ['A {unit} is lobbing shells over our domes. Find it.', 'That {unit} gets over the shields. Stop it.'],
    lost: ['The {unit}’s dome is down. It’s gone.', 'We lost the {unit}. Shields up regardless.'],
  },
  rime: {
    attack: ['Freeze the ground to {enemy}. Advance.', 'Cold front moving in on {enemy}.'],
    regroup: ['Fall back to the frost. Let them slip.', 'Back to the cryo plant. Chill.'],
    defend: ['Ice the approaches. They’ll crawl to us.', 'Freeze them at the door.'],
    took: ['{where} is ours. Frost it over.', 'Took {where}. Keep it cold.'],
    hunt: ['A {unit} out in the warm. Go fetch it.', 'Freeze that {unit} where it sits.'],
    lost: ['The {unit} has thawed for good.', 'We lost the {unit}. Stay frosty.'],
  },
  sabre: {
    attack: ['Blades out. Charge {enemy}!', 'Close the distance. Hand to hand with {enemy}.'],
    regroup: ['Sheathe blades. Back to the duel hall.', 'Fall back and whet the edges.'],
    defend: ['They came to our hall. Cut them down.', 'Duelists, at the gate!'],
    took: ['{where} won by the blade.', 'Took {where}. Fair fight.'],
    hunt: ['A {unit} hides behind its range. Go and cut it.', 'Close in on that {unit}. It can’t shoot what’s next to it.'],
    lost: ['The {unit} fell with its hammer high.', 'We lost the {unit}. Steel on.'],
  },
  cipher: {
    attack: ['Executing attack on {enemy}.', 'Target acquired: {enemy}. Proceed.'],
    regroup: ['Attack routine complete. Returning to base.', 'Withdraw. Recompile.'],
    defend: ['Intrusion at the base. Jam everything.', 'Hostiles in the perimeter. Turn their tanks on them.'],
    took: ['{where}: access granted.', '{where} is ours. Patch it into the network.'],
    hunt: ['Locating {unit}. Dispatching hunters.', 'A {unit} is out of range. Correcting that.'],
    lost: ['Signal lost from the {unit}.', 'The {unit} has gone offline.'],
  },
  veil: {
    attack: ['Into the haze. {enemy} won’t see us coming.', 'Smoke out. We move on {enemy} quietly.'],
    regroup: ['Fade back. Let the haze cover us.', 'Withdraw under smoke.'],
    defend: ['They found the base. Thicken the haze.', 'Smoke the approaches. Shades, wait for them.'],
    took: ['{where} is ours, and nobody saw a thing.', 'Took {where} in the smoke.'],
    hunt: ['A {unit} out there. Shades, go quietly.', 'Slip round to that {unit}.'],
    lost: ['The {unit} is gone. Into the smoke with it.', 'We lost the {unit}. Stay unseen.'],
  },
  zenith: {
    attack: ['Beacons forward. We drop on {enemy}.', 'Uplinks hot. Bring it down on {enemy}.'],
    regroup: ['Pull back to the beacons and reform.', 'Hold the drops. Regroup.'],
    defend: ['They\'re at the base. Drop everything on it.', 'Paint the attackers. Strikes on the base perimeter.'],
    took: ['{where} secured. It takes drops now.', 'Beacon planted at {where}.'],
    hunt: ['Paint that {unit} for orbit.', 'Mark the {unit}. Runners, go.'],
    lost: ['The {unit} is down. Keep the beacons lit.', 'We lost the {unit}. Drops continue.'],
  },
  hive: {
    attack: ['The swarm moves on {enemy}.', 'Hungry. Feed on {enemy}.'],
    regroup: ['Back to the nest. Breed.', 'The swarm draws back.'],
    defend: ['Intruders at the nest. Swarm them.', 'They are at the Recycler. Bite.'],
    took: ['{where} is ours. The scrap there is ours.', 'The swarm holds {where}.'],
    hunt: ['A {unit}. Strip it.', 'Find the {unit}. Eat it.'],
    lost: ['The {unit} is gone. More will hatch.', 'We lost the {unit}. Chew its wreck.'],
  },
  nomad: {
    attack: ['Roll out. The camps follow us to {enemy}.', 'Outriders first. On to {enemy}.'],
    regroup: ['Fall back to the camps.', 'Back to the crawlers. Regroup.'],
    defend: ['They\'re at the HQ. Turn the column round.', 'The base is hit. Everyone home.'],
    took: ['{where} is ours. Bring the crawlers up.', 'Took {where}. We camp there tonight.'],
    hunt: ['Outriders, run down that {unit}.', 'Chase the {unit} down.'],
    lost: ['The {unit} is gone. Keep moving.', 'We lost the {unit}. The column rolls on.'],
  },
  antiquity: {
    attack: ['Testudo! Forward against {enemy}!', 'For glory! March on {enemy}!'],
    regroup: ['Sound the retreat. Back to the fort.', 'Re-form the line!'],
    defend: ['The barbarians are at the gates!', 'Man the walls! Defend the castrum!'],
    took: ['{where} is ours. Raise the standard.', 'We have taken {where}. Build a road to it.'],
    hunt: ['That {unit} is an abomination. Bring it down.', 'Elephants, charge the {unit}!'],
    lost: ['The {unit} has fallen. The gods are cruel.', 'We lost the {unit}. Write it in the annals.'],
  },
  tin: {
    attack: ['Wind them up! Quick march on {enemy}!', 'Tick, tock. Forward against {enemy}.'],
    regroup: ['Back to the toy box.', 'Everyone wind up and fall in.'],
    defend: ['Someone is in the playroom! Defend the toy box!', 'Stand up straight and hold the line!'],
    took: ['{where} is ours. Plant the little flag.', 'We have taken {where}. Tick, tock.'],
    hunt: ['Knock over that {unit}.', 'March on the {unit}.'],
    lost: ['The {unit} is broken. Put it back in the box.', 'We lost the {unit}. Its spring went.'],
  },
};

/** Lines for a doctrine without a voice of its own. */
const PLAIN: Lines = {
  attack: ['Attack {enemy}.', 'Move out against {enemy}.'],
  regroup: ['Pull back and regroup.', 'Fall back.'],
  defend: ['The base is under attack. Hold.', 'Defend the base.'],
  took: ['{where} is ours.', 'Took {where}.'],
  hunt: ['Hunt down that {unit}.', 'Find the {unit}.'],
  lost: ['We lost the {unit}.', 'The {unit} is gone.'],
};

/**
 * A line for this doctrine's Commander, with the gaps filled in. `n` picks
 * among the doctrine's lines for the moment (so the same moment twice in a
 * row says something different).
 */
export function voiceLine(doctrine: DoctrineId, moment: VoiceMoment, n: number, fill: { enemy?: string; where?: string; unit?: string }): string {
  const lines = (VOICES[canonicalDoctrine(doctrine)] ?? PLAIN)[moment];
  const line = lines[((n % lines.length) + lines.length) % lines.length];
  const text = line
    .replace(/\{enemy\}/g, fill.enemy ?? 'the enemy')
    .replace(/\{where\}/g, fill.where ?? 'the outpost')
    .replace(/\{unit\}/g, fill.unit ?? 'gun');
  // A filled gap may start the line ("{where} is ours"): capitalise it.
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Every doctrine that has a voice of its own. */
export function voicedDoctrines(): DoctrineId[] {
  return Object.keys(VOICES) as DoctrineId[];
}
