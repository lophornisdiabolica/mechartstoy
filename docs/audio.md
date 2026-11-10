# Making sound without hearing it

*How Claude designed, built and checked the audio for the mech battle toy*

The mech battle toy had no sound. Playtesters kept asking about it, so we
added some. The brief was to keep it mostly ambient and make it as
tuneable as the battles are: a volume slider, a "focus" slider for how
closely the sound follows the camera, and a mix panel to set gunfire,
artillery and alert chimes separately.

This note covers how that work was done, for anyone curious how an AI that
can't hear goes about making audio. The short version: I write programs
that make sound, then check them with numbers and pictures instead of ears.
A person does the final listening.

## The constraint: I can't hear

I can't listen to audio. I can read and write code, do arithmetic on
arrays of samples, and look at images. So the work is set up so that every
sound is something I can describe, build, measure and draw:

1. **Describe** the sound physically. What happens in the first few
   milliseconds, which frequencies carry it, how long it rings.
2. **Build** it in code from basic parts: noise, sine waves, filters and
   volume envelopes. No recordings.
3. **Measure** what came out: length, peak and average loudness, where the
   energy sits in the frequency range.
4. **Look** at it. A spectrogram turns a sound into a picture, with time
   going across, pitch going up and loudness shown as brightness.
5. **Hand it to a person to listen to**, and turn what they say ("too
   boomy", "sounds like rain, not gunfire") into specific changes.

## Choosing an approach

There were three options:

- **Recorded sound effects.** These can sound great, but they need
  licensing and asset files, and every variation needs another recording.
  They also don't fit a toy where everything else is generated.
- **AI-generated audio clips.** I can't make these myself, I'd have no way
  to check them, and they'd still be fixed files.
- **Procedural synthesis.** Every sound is a short recipe in code. There
  are no files to license, the code is tiny, anything can be tweaked with
  a number, and the same recipe gives the same sound every time. That last
  part matters because it makes the sounds testable.

I chose synthesis. One refinement keeps it cheap: the sounds aren't
synthesized live for each shot. When audio starts, every recipe runs once
in a background thread and the results are kept as short clips. During
the battle, playing a sound just means playing one of those clips. Each
sound has three slightly different versions and plays at a randomly
varied speed, so a long battle doesn't repeat the identical gunshot a
thousand times.

## Sounds as recipes

Most short sounds break down into an **attack** (the first few
milliseconds, which tells you what it is), a **body** (the main tone) and
a **tail** (how it dies away). Each recipe builds those parts separately
and mixes them:

| Sound | Recipe |
|---|---|
| Rifle shot | A 6 ms burst of bright, filtered noise (the crack), a short burst of mid-range noise (the body) and a small low thump, all slightly overdriven. |
| Tank cannon | A hard click, a sine wave dropping from 110 Hz to 42 Hz (the thump), and a noise tail whose filter closes over a quarter second so it rolls away. |
| Rocket | Noise through a resonant filter that sweeps up through about two and a half octaves, giving a rising whoosh. |
| Big blast | A crack, a low sweep, a long noise "cloud" that gets darker over time with random swells in volume (the rolling), and sparse clicks for falling debris. |
| Building collapse | A long low rumble, with heavier crunches near the start that thin out as it settles. |
| Alert chimes | Synthesized bells. Each is a handful of sine waves at slightly uneven ratios (which is what makes a bell sound like a bell), with the higher ones fading faster. An outpost capture rises in pitch, a fallen super unit falls, and a victory plays a short major arpeggio. |
| Wind (looping) | Very low "brown" noise through a filter that drifts slowly, so it gusts. The end crossfades into the start so the loop has no seam. |

These recipes come from general knowledge of acoustics and sound design,
such as how explosions sound and why bells ring the way they do. I can't
check by ear whether they work, so that knowledge has to be paired with
measurements.

## Checking without ears

`npm run sounds` renders every sound to a WAV file for a person to listen
to. For each sound it also writes a spectrogram image and prints a
one-line report:

```
blast-1.wav   2.60s  peak -0.9 dB  rms -13.9 dB  sub/low/mid/high % 19 47 26  8  centroid 819 Hz
```

The four percentages show how the sound's energy splits across four
frequency bands: below 100 Hz (sub), 100–500 Hz (low), 500–2000 Hz (mid)
and above 2000 Hz (high). The centroid is roughly where the sound's
"centre of brightness" sits.

This report caught the most important problem before anyone listened. In
the first version, the artillery boom, the big blast, the collapse, the
earthquake and the war rumble each had **83–95% of their energy below
100 Hz**. That would sound great on a subwoofer, but laptop speakers and
phones barely play anything that low, so most playtesters would have
heard almost nothing.

The fix was a common one in game audio. I raised the main body of each
boom into the 100–500 Hz range and added soft overdrive. Overdrive adds
harmonics, and the ear uses them to infer a bass note the speaker can't
actually play. After the retune, the big blast's energy split is 19%
sub, 47% low and 26% mid. On large speakers it is still a deep blast, and
on small ones it can now be heard.

The other checks are automated tests that run with the rest of the test
suite:

- every sound renders without invalid values and stays within range
- every sound ends in silence, so it never cuts off with a click
- every loop's end meets its start, so there's no seam
- the same recipe always gives the same samples

The spectrograms are a sanity check on shape. A gunshot should be a
bright vertical stripe. A bell should be clean horizontal lines that fade
out. A blast should be a wide bright burst that darkens and narrows, with
specks of debris. When a picture doesn't match the description, something
in the recipe is wrong.

## From battle events to what you hear

The game already tells the visual effects layer whenever a shot is fired,
a shell lands, a unit or building is destroyed, an outpost changes hands,
and so on. The audio listens to the same events. Each event becomes a
request for a sound at a place on the map, and three rules decide what is
actually heard:

**Where the camera looks.** Distance is measured in screen sizes, not map
units. So zooming in narrows what counts as close, and zooming out takes
in more of the battlefield. The **Focus** slider sets how quickly sound
falls away beyond the edge of the screen. At the low end you hear the
whole battle about equally. At the high end, things on screen are clear
and everything else is a muffled murmur. Distant sounds go through a
shared filter that removes their high frequencies, the way distance does
in real life. Sounds are also panned left or right by where they are on
screen.

**A budget.** A big battle asks for 150–280 sounds a second. Playing all
of them would be noise, and expensive too. Each frame, only the loudest
few in each category get played, up to 28 sounds at once in total. In
that 6-side battle, about 40 sounds a second actually play.

**Ambient beds.** The sounds that don't make the cut still count. Every
shot and blast anywhere on the map raises a "war level" that slowly fades
back down, and two looping beds follow it: a deep rumble and a crackle of
distant gunfire. When you're zoomed out over a big battle, you hear a
roar rather than a thousand separate shots, which is also how a crowd of
distant guns really sounds. This is what keeps the audio mostly ambient.

Alert chimes work differently. By default they are heard wherever they
happen and are never muffled, because their job is to tell you something.
They queue up and play at least 0.9 seconds apart so a burst of captures
doesn't jangle. There's an option to make them follow the focus like
everything else.

## Performance

Long battles were the worry, so I measured three things:

- **Startup:** making all the clips takes about a second of computing.
  That happens in a background thread, so the game doesn't stall.
- **Per frame:** a load test played a 20-minute, 6-side battle on a large
  map at 4× speed (about 500 units), feeding every real event through the
  real audio code. The audio's work on the game's main thread averaged
  **0.024 ms per frame**, against a budget of about 16 ms per frame at
  60 frames a second. A medium 1v1 averaged 0.005 ms.
- **In the browser:** I ran the game in a headless browser and recorded
  the actual mix coming out. It had no errors and no clipping, and its
  loudest moments peaked about 4.5 dB below the maximum at default volume.

The audio also stops completely while muted or when the tab is hidden. The
P stats overlay shows the audio's live cost, how many sounds a second are
requested and played, and the current war level.

## Second pass: checking against real recordings

Playtesters said the first version sounded too tinny, sizzly and metallic.
One said the gunfire sounded like "rain on a metal roof". The rockets
sounded like wind, the wind sounded like plain white noise, and everything
sounded too close, even things far away. Someone who knows audio read this
note and suspected I had overcorrected for small speakers and the booms
just needed more bass.

This time I didn't rely on my own sense of what a gunshot sounds like. I
measured real recordings to see what my versions were missing. I gathered
72 reference clips from public sources: two datasets of recorded sound
(wind, rain, thunder, fireworks and crackling fire) and sound effect files
from open-source game projects (rifle shots, rocket launches, tank guns,
distant explosions). I ran each one through the same analysis as my own
sounds. The references were only measured, never copied: every sound in
the game is still made from scratch in code. The table below shows the
share of energy in each frequency band, plus the centroid (roughly where
the sound's brightness sits).

| | below 250 Hz | 250 Hz–2 kHz | above 2 kHz | centroid |
|---|---|---|---|---|
| Real gunshots | 41% | 32% | 26% | 1270 Hz |
| My first rifle | 7% | 61% | 32% | 2410 Hz |
| Real rain | 12% | 31% | 57% | 2670 Hz |
| My new rifle | 64% | 19% | 17% | 1300 Hz |
| Real rocket launches | 58% | 36% | 6% | 430 Hz |
| My first rocket | 1.5% | 85% | 14% | 1320 Hz |
| My new rocket | 50% | 49% | 1% | 385 Hz |
| Real tank guns and booms | 84% | 13% | 3% | 190 Hz |
| My first cannon | 88% | 7% | 4% | 410 Hz |
| My new cannon | 83% | 16% | 1% | 230 Hz |

Each piece of feedback had a cause the measurements could show:

- **Rain on a metal roof.** My rifle had almost none of a real gunshot's
  low muzzle blast. Its body came from a narrow filter around 1 kHz, which
  rings. Remove the low end and add a ring, and a fast stream of shots
  sounds like rain on metal. The new rifle has a strong low blast and a
  broad body with no narrow filters. Its 2–8 kHz energy is about a quarter
  of rain's, where before it was about half.
- **Rockets that sounded like wind.** Real launches are a low roar
  centred around 120–500 Hz. Mine was a rising, hissing sweep, which is
  essentially how you synthesize wind. The new one is an ignition thump
  followed by a low motor roar with a rough flutter in it, and it gets
  darker as it flies off.
- **More bass.** The friend was right. Real booms keep 84% of their
  energy below 250 Hz, so lifting mine into the 100–500 Hz range had gone
  too far. The cannon, blast and artillery now sit close to the recorded
  profiles. They keep a little energy higher up for small speakers.
- **Metallic.** Three things caused this: the narrow ringing filters, a
  bell-like clank I had put in vehicle wrecks, and heavy overdrive on
  everything, which adds buzzy upper harmonics. The clank is gone, the
  filters are broad, and the overdrive is much lighter. Construction knocks
  are now low and dull.
- **Wind that sounded like noise.** Measuring the recorded wind showed it
  isn't one sound. It swells in gusts, with a low buffeting from the
  wind on the microphone and soft whistles whose pitch rises as each gust
  builds, all moving together. My first wind was one steady band of
  filtered noise. The new one builds those layers and drives them all from
  the same slow, random gust curve.
- **Too close.** Recorded distant explosions have almost nothing above
  1 kHz, and every recording of a battle has the space around it.
  The camera in this game is always well above the ground, so now every
  sound, even one in the middle of the screen, is partly muffled and partly
  reverberant, and more so the further out the camera is zoomed. The
  reverb is synthesized too: a few early echoes off the ground, then a
  two-second tail that loses its high frequencies as it fades. One shared
  reverb serves every sound, so it costs the same whether 2 sounds are
  playing or 28.

In a recording of the actual in-game mix, energy above 1 kHz fell from
19% to about 2%, and most of the mix now sits between 60 and 500 Hz. The
main-thread cost in the 6-side load test is still about 0.03 ms per frame.

Matching a band profile doesn't make a sound good. It only shows that the
sound is in the right ballpark. The references turned vague words like
"tinny" and "windy" into numbers I could act on, but a person still has to
listen to the result.

## Third pass: the tail of a gunshot, and the size of the space

After the second pass the explosions, cannons and wind were close. Two
things weren't. The gunshots sounded "tappy", and the friend who knows
audio thought the reverb sounded like a space that was too small. Both
came down to time rather than frequency, so I measured how sound decays
over time.

**Gunshots.** The recorded rifles fell into two groups. Close, dry
recordings put about 1% of their energy after the first 100 ms. Outdoor
recordings put 15–40% there, because the shot rolls away and comes back
off the land for about half a second. My rifle was in the first group:
everything happened in 100 ms, then silence. That's a tap. It now has a
rolling "report" that darkens and swells slightly as it fades. That puts
15–24% of its energy after 100 ms, and it drops by 40 dB at about 0.6 s,
the same as the outdoor recordings.

**The space.** Your ears judge a space's size mostly from when the echoes
start and how they arrive. In a small room the first reflections come
back within a few milliseconds, densely packed. Outdoors, the first echo
off a hill or building comes back late and on its own, and the tail is
long and sparse. My first reverb had its first echo at 15 ms and 28% of
its energy in the first 80 ms, which is a room. The new one has nothing
for the first 44 ms, then six separate slap-backs spread over the next
0.4 s, then a dark tail with a reverb time of about 3 seconds. Under 1%
of its energy is in the first 80 ms. `npm run sounds` now writes the
reverb out as `reverb-impulse.wav`, so you can hear the space on its own.

## What still needs a person

Measurements can tell me a sound is the right length, isn't clipping and
will come through on a laptop. They can't tell me whether it sounds good,
whether the cannon is satisfying, or whether the chimes get annoying after
an hour. That part is taste, and it needs someone listening.

Feedback is most useful when it describes the sound in plain words, as
the second pass showed. "The
rifles sound like typing" tells me the attack is too clicky and the body
too short. "The big explosions are mush" points to the rumbling cloud
drowning out the crack. "I can't hear the artillery on my laptop" means
there's too much energy below 100 Hz again. Each of these maps to a
specific number in a recipe, and after the change the report and the
spectrogram show whether it moved the way it should.

## Trying this yourself

Nothing here needs special tools: a language that can do arithmetic on
arrays, a way to write WAV files (a 44-byte header plus the samples), and
something to draw a spectrogram. The method is what matters:

- Treat each sound as a recipe of attack, body and tail.
- Check how the energy splits across frequency bands, not just how loud it is.
- Make the sounds deterministic so they can be tested.
- Pre-render the sounds and play clips rather than synthesizing live.
- Budget how many sounds play at once, and let everything that doesn't
  fit feed an ambient bed.
- Leave the final call to someone with ears.
