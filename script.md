Hello everyone, thank you for coming today and to the organisers for having me. Today I will be taking you on a whistle-stop tour through some of the fundamentals of digital analogue sound design and I am going to try and do it through code. 

Now, the purpose of this talk is to take you through the concepts rather than implementation. So while there will be p5 sketches of all of the steps - they are going to serve more as documentation and something you can play around with. These are general sound design concepts based on analogue synthesis and are not unique to p5 or code-based music environments, so you can take them to whatever platform you choose. I am using p5 because it provides the right abstraction for demonstration while still giving you an idea of how things work, but for more musical or artistic purposes there are other options such as Strudel, SuperCollider, Max/MSP or many more. 

I will also warn that the sound isn't at all mixed so there may be loud, unexpected, or irritating noises. So if you are sensitive consider this your warning.

I will circulate a git repository with the sketches and a link to p5 but to keep it simple I am going to open it in a browser. 

> Example / question pause: Show the index page and point out that each sketch is a small browser example. Ask: "Is everyone clear that p5 is just the demonstration layer here, not the only place these ideas can live?"

---

Now, with that out of the way, I should introduce myself. My name is Jeremy... I work at the Royal Ballet and Opera as a tech lead on Digital Products, and I am also a sound artist who works with modular systems and likes to use the sounds of other artists as stimulus. An over-arching theme for me is a creative approach to building systems that create their own inspiration. It is important in a world where generative art has been taken over by LLMs and diffusion models and obfuscated the original meaning of generative art: namely, rules-based systems rooted in the very human behaviour of play as experimentation which through feedback and interaction generate an evolving palette of inspiration driven by process rather than the end product itself - and the key to this is noise. 

If you were here last time, Dea gave a great presentation on noise - mostly in the visual space. At one point she showed us how to generate a sound wave with Perlin noise and left us to work out "how do I make this musical". This talk is sort of an unofficial companion where I want to show you how noise can be the key to unlocking sound design. 

------

So what is noise in the realm of sound? If you have spent any time at all around sound artists you will know they are liable to wax lyrical about the distinction between noise and its opposite as it manifests psychologically/sociologically - but the simplest definition is physical.

(Show Looping Oscillator Sketch)

Now bear with me for a moment as this part has a bit of jargon so I have prepared a visual tool to help

A sound wave, as we may know, can be represented as electrical current with an oscillating frequency. The frequency is the rate at which the wave function repeats. If you think of a sine wave as a circle - it is the revolutions of that circle over a given amount of time, expressed in Hz, that determine the frequency

Pitched sound has a relatively stable frequency centre. A sine wave being the most balanced and therefore 'purest' tone, whereas white noise is a random and non-repeating wave function. As a wave deviates from its tonal centre - it creates harmonics. 

Essentially... smooth sounds clean, jagged noise sounds messy.

So how do we make a Perlin noise tonal... we repeat it, and the repeating pseudo-random pattern creates unique harmonics.

> Example / question pause: In the function generator, switch between sine, white noise, and Perlin-like noise. Then change the frequency slowly. Ask: "Can you hear the moment where repeated noise starts behaving like a pitched instrument?"

-----

But none of this is particularly musical now is it? So let's turn this into a groovebox...

(Show Noise Percussion)

In analogue synthesis you use one signal to modify another signal, and because sound waves move in patterns this creates a form of automation. The most basic form is amplitude modulation. Changing a signal's amplitude is like tweaking the volume on a stereo. If we do it in a rhythmic pattern, it starts sounding like a beat. The signal is referred to as control voltage.

This particular shape of control voltage is called an envelope. Because it opens and then closes. In this case an Attack Decay or Attack Release envelope - the Attack variable controlling the speed at which volume reaches max and Decay how quickly it reaches minimum. This is actually how the hi-hats on the Roland TR-808 and other early drum machines worked, just with a little bit of filtering.

> Example / question pause: In noise percussion, make the attack slow, then make it fast again. Lengthen and shorten the decay. Ask: "Which control changes the hit, and which control changes the tail?"

> Optional quick bridge: Show AM / Ring Mod for one minute. Start with slow tremolo, then raise the rate just enough that it begins to feel like timbre rather than volume. Do not dwell on sidebands; the takeaway is that modulation speed changes what we perceive the modulation as doing.

You can also use this to make a bass sound by giving it something tonal. In this case our Perlin sampled loop.

Control voltage can also control the cutoff frequency on a filter - which shapes the sound by removing harmonics, thus allowing control over timbre - and this is how we get the most classic form of synthesis: subtractive synthesis.

(Show subtractive patch)

> Example / question pause: Sweep cutoff first, then resonance, then envelope amount. Ask: "Does this feel like changing the note, or changing the brightness and shape of the note?"

------

There are two other main forms of modulation:

- Additive synthesis: Where we start with a sine wave and add harmonics. This can become wavetable synthesis that morphs between waveforms and allows us to create those crazy EDM and sci fi sounds, or physical modelling where we recreate the exact sound of a real instrument
  (show additive patch)
- Frequency Modulation: Where we modulate the frequency and change pitch - but at a smaller 
  range, this can change timbre. I won't get into FM too heavily because it gets quite complicated but this can make both really gnarly industrial sounds and was used on the Yamaha DX7 to make the electric piano sound that at one point in the 80s was on almost every radio hit.
  (show frequency patch)

> Example / question pause: In additive, raise one harmonic at a time. In FM, move modulation index slowly. Ask: "Can you hear the difference between adding harmonic ingredients and bending one oscillator with another?"
  
(show kick patch)

This is how a classic 808 kick works - we use frequency modulation to lower the pitch of any given sound wave and that gives that punchy pulsating sound. There is an element of noise working here too - the millisecond click which makes sure the transient is nice and percussive.

> Example / question pause: In the kick patch, exaggerate the pitch drop, then shorten it. Raise and lower the FM amount. Ask: "Can you separate the body of the kick from the punch at the start?"

---

But the real fun when it comes to noise and sound design... is as a source of generative randomness. The most classic form of this being a sample and hold which you will recognise from the voice of R2D2, countless 8-bit video games and, as I found out on a recent excursion to Bletchley Park, is not too dissimilar to a circuit used on Turing's code-cracking machines.

So how does this work? The noise source is sampled at a certain rate and whatever frequency the noise wave is playing when sampled is held until the next sample is taken. This creates a stepped function with stable, almost digital, values.  The higher the amplitude of the noise fed in, the greater the range; the lower, the more controlled. This can be used to modulate pitch, so you get entirely randomly generated melodies. These pitches can even be 'quantised' or rounded to fit a musical scale and sampled and looped themselves to create repeating motifs.

> Example / question pause: In sample and hold, change the rate, then toggle quantise. Then show the breakbeat slicer and explain that the same held value can select a buffer slice instead of a pitch. Ask: "What else could this random held value choose?"

And we aren't limited to just pitch either. We can modulate filter cutoffs and resonance. It is even possible to use sample and hold to select locations in a buffer or items from a list, which jungle and breakbeat producers will do to chop up their samples. 

----
So what do we get if we pull this all together.

> Example / question pause: Before the final groovebox, invite questions on the building blocks. Then use the groovebox as the recap: kick from pitch/FM envelope, noise percussion from envelopes, bass from subtractive synthesis, lead from FM, lead AM from amplitude modulation, lead S&H pitch from sample-and-hold, and filters as performance controls.

- Tonal sound waves with musical envelopes
- Random yet musical pitch
- Atonal percussion - of various kinds 

Put these together and we have all the elements we need to construct a perfectly functional groove box on which you can make a track capable of representing England in an international song contest that doesn't artwash a genocidal state.

Thank you everyone for listening. I will be around afterwards if you would like to discuss any of this further and I look forward to hearing the other two speakers.
