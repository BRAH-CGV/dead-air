# Dead Air — Story and Gameplay (official)

> **This is the canon story for Dead Air.** It overrides every other document
> in the repo. Where another doc, a plan, a handoff or the current build
> disagrees with it, this file is right and the other one is out of date.
> Parts of the build that don't match it yet will be reworked.

---

# Exposition
You are one of a few hundred brave explorers scattered across the surface of a future Mars.
Many colonies have been sent in the past, all have gone silent. Previous efforts have revealed that there is a critical mass of people that seems to trigger each silence, and that whatever causes it comes from the sky.

You have been assigned to array \[random coordinate bs\]. Your task is to scan the night sky while also keeping the local array operational for your neighbours, who are tasked to do the same.
The technology you have been supplied with is intentionally very low-powered to avoid the risk of another silence cascade.

# Gameplay
Threats are accumulative.
- Night 1
	- Your fatigue is your enemy
	- Staying awake to do your job is the bare minimum
	- Sleep deprivation has been known to cause hallucinations, its normal. Just make sure to keep your energy up
	- (its not normal) (there is an entity that will ***get you*** if your stamina runs out)
- Night 2
	- Server room opens up, go there to process the signals from last night and to tune the satellites
	- Dust storm eyes and evil signal threats have a chance to show up
	- Number of signals needed to scan increases
- Night 3
	- Outside opens up, go there to fix the power or cut it off if you feel a reason to.
	- UFO/energy sweep thing starts showing up
	- Glowing orb entity starts showing up
	- Number of signals needed to scan increases
	- Previous threats become more frequent/common
- Night 4..? and onwards..? if we have time
	- We would need to have upgrades or some other reason to keep going
	- Threats and number of signals would scale up each night but no new rooms added
Either we show a boring "you win!" screen after the third night or we make it endless while getting progressively harder

# Locations
- Living area (bedroom, bathroom, maybe kitchen) (mostly decorative)
- Main room
	- Contains computer in front of the big ass window
	- Food/coffee dispenser
- Outside
	- Connected to main room by airlock
	- Location of the breaker box/generator/power thing
- Server room
	- Bring scanned signals here for processing
	- Maybe a minigame to actually process the signals
	- Have to calibrate satellites from time to time
## Night sky scanning
- Computer shows you the satellite overlay
- Aim the cursor and the dishes will follow
- Look for signal 'blips', aim the satellites, and start scanning.
- Download each signal to a drive and \[do something with it, not sure yet\]
- Signal blips appear occasionally throughout the night
- There is a lightbulb that will indicate when there is a signal to scan

## Power and breaker box
- Breaker box outside to shut off the power, or play a minigame to fix the power when it gets broken

## Random events
- The dishes you don't control will move around randomly during the night. It's just your neighbours working, nothing to worry about :)
- Dust storms will happen randomly lowering visibility out the window significantly

## Entities/threats
- Shadowy sleep demon guy
	- Visibility is directly tied to how tired you are
		- You can only see it in the corner of your eye... usually...
		- Trying to look at it will make it fade away as if there is nothing there. But this isn't a solution to your problem, its still there.
	- Keep your stamina up to avoid him
	- If your stamina runs out then he grabs you and you lose the night
- Evil signal
	- Blip looks or acts slightly different than all the others
	- Scanning/hovering over it will be a lot quicker and will cause the inserted drive to:
		- Shoot out of the slot
		- Glow red
		- Shoot red sparks maybe?
		- Probably bounce around a bit idk
		- Have an increasingly loud sound
	- Ignoring the blip until it fades is the ideal way to deal with it
	- If it does get into the drive, you have to destroy it before it gets too loud
		- If you don't destroy it in time then everything should turn red for a frame or two, then cut to black. You lose the night
- UFO or energy sweep thing
	- Something powerful shows up on the radar/computer screen
		- Causes the signal indicator to go crazy
		- Can see it sweeping closer to your dish on the computer
	- When it reaches you a few things will happen:
		- If you are in view of a window or outside, you die and lose the night
		- If the power hasn't been cut:
			- All the lightbulbs go super bright and then explode (including the indicator light for signals). They remain down for the rest of the night
			- The breaker box breaks and you need to fix it
		- If the power has been cut:
			- Nothing special happens. You just need to turn it back on after it passes
	- After it passes, if you're still alive, then get back to work.
- Camera entity
	- I'm not too sure for this one anymore. The original idea was having it only be visible through cameras, but I'm not sure where we would put cameras and why they would be there?
- Glowing orb entity
	- Will pass by the window randomly, with it's glow and a faint hum indicating when it's on its way.
	- If it sees you then it breaks or melts through the window and kills you, you lose the night
- Dust storm eyes
	- Don't look at them
	- Looking at them either causes them to kill you or just jumpscares and then lowers stamina (undecided)

## Inbetween-nights upgrade ideas (if we have time)
Depends on performance in the previous night. Either money based or threshold based
- Faster scanning
- More sensitive satellites (shows signals more frequently)
- Bigger search area (should start super zoomed in around the cursor on the computer)
- Quicker satellite turning
- Bigger neighbour range
- Faster signal processing
- Slower satellite calibration decay
- Quicker airlock
- More suit air (if we want the time outside to be limited)
- Fix lightbulbs (after failed UFO/energy sweep event)
- Fuse (stops lightbulbs from breaking during sweep event, but gets used up)
- Quicker food/coffee dispensing
- Audible signal alert
- Flashlight strength/battery life
- Dust storm filter (if we make signals scan much slower during dust storms)
