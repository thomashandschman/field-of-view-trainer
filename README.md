# Glühwürmchen-Augen (Firefly Eyes)

Eye-movement and field-of-view practice games for a child, using the selfie camera. One web app runs on iPhone, iPad and Mac in Safari. Tracking runs on the device, and nothing is uploaded.

## What it does

| Part | How |
|---|---|
| Head stays still | The 3D head pose from MediaPipe Face Landmarker is compared with a baseline taken during calibration. If the head turns or shifts more than the tolerance (5°, 8° or 12°), the game freezes and shows "Statue!". If the head then rests about 1.5 s at a new place, that place is adopted and the gaze is re-aimed with a short "look at Ollie" (over 18° away: full recalibration). Every round also starts with this short re-centring, so sitting differently between rounds never locks the game. |
| Eye movement | Iris position (landmarks 468/473 relative to the eye corners) is combined with the eye-look blendshapes. A 9-star calibration at the start of each session maps these to screen positions. |
| Engaging the eyes | **Basketball** combines both: the eyes follow the bouncing ball while the player dribbles across the court (pursuit); when the shot meter is full a hoop lights up at the edge, and looking at it makes the player shoot (saccade), with 2 or 3 points per basket. A short picture guide explains it before each round, and on-screen hints ("Augen auf den Ball!", "Schau zum leuchtenden Korb!", a dotted flight path) help during play. **Firefly Chase** trains smooth pursuit: the firefly only moves while the eyes follow it. **Ball Hop** (Ball-Hüpfer) trains saccades: look from the owl to a bouncing basketball at the edge, then back. **Pendulum Catch** (Pendel-Fänger): a basket on a rope swings to wherever the eyes look; basketballs and golden stars drop from alternating sides, so the eyes jump out and ride them down. Catches build combos (×2, ×3, ×5) with banners, fireworks and floating points; golden stars give +50. **Secret Spotter** trains peripheral detection: eyes stay on the owl, a bug flashes at the side, and the child taps that side. Looking at the bug counts as peeking. |
| Gradual progress | "Reach" (how far from centre targets appear) is tracked separately for left, right, up and down. It grows after repeated hits and shrinks after misses. Firefly speed and how long the bug stays visible also adapt. |
| Short sessions | Rounds of 45 to 120 s, an eye break after each round (eyes closed for 5 s, detected by the camera), and a daily minute limit. |
| Motivation | Stars, and a sticker book of 27 stickers (each character in three colours, one per 12 stars). Every spoken line is a recorded German clip, and there are sounds. |
| Parent area | Press and hold the button at the bottom of the home screen. It shows reach per direction (and estimated degrees if the screen width is entered), a session log, CSV export for the physio, and all settings. |

## Language, voice and art

- The app is in German by default. English is still available in the parent area, where it uses the device's own voice.
- All clips are decoded when the page loads, so the first sentence is never spoken by the device's own voice.
- Spoken lines never cut each other off: they queue, and the eye-break count waits for each number to finish.
- The spoken lines are 30 German clips recorded with the ElevenLabs voice "Carlotta – Children's Stories" (`audio/de/*.mp3`). To change a line, regenerate that clip and keep the file name.
- The characters (Ollie the owl, the firefly, the star and six critters) and the night-meadow background were generated with ElevenLabs image models, with backgrounds removed (`img/`). Glow, sparkles and motion are drawn live on top of them.

## Run it

- **Mac:** `python3 serve.py` in this folder (it disables browser caching, so code changes always load), then open http://localhost:8642 in Safari or Chrome.
- **iPhone/iPad:** the camera only works over HTTPS, so the folder has to be hosted, for example on GitHub Pages. In Safari, use Share → Add to Home Screen to get a full-screen app.
- **Without a camera:** add `?demo` to the URL and the mouse or finger acts as the eyes. Hold the C key to simulate closed eyes in the eye break. `?test` runs the real head-stillness logic on a simulated head (`window.__pose`) for checking.

## Setup tips

- Use the largest screen available, at eye level and close, about 30–40 cm (a forearm) away. The closer he sits, the further the eyes have to move. The app reminds him if he sits back further than about 50 cm. An iPad or Mac in landscape gives more room left and right than an iPhone.
- Use bright, even light on the face with no strong light behind the child.
- Calibrate again if the device or chair moves. The app also recalibrates after 10 minutes.

## Limits

- Webcam eye tracking is coarse, roughly a tenth to a fifth of the screen width, so the games use generous target zones. Vertical tracking is less precise than horizontal.
- A screen at normal distance covers only the central field of view, about ±15–25° on an iPad or Mac. The app trains eye movements and attention toward the edges of that range. It does not measure the visual field and is not a medical device.
- Agree the settings and session length with the physiotherapist.
