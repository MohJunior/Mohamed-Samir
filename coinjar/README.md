# 🫙 Coin Jar

When you're burnt out, it helps to *see* that your time is worth something.
Enter your pay, hit **Start working**, and watch coins drop into a jar in real
time. A cozy cat types next to you, and lofi music plays while you work.

## Features

- **Pay → live earnings**: hourly, daily, monthly or yearly salary (it converts using your hours per week), in 20 currencies.
- **Coin jar with physics**: coins fall and stack up. Each coin's value is picked so one drops about every 9 seconds. When the jar is full, it empties and counts as a jar filled. Click the jar to shake it.
- **Wishlist**: add things you want to buy. Each one shows a progress bar and how many hours of work are left until you can afford it. ⭐ one to pin it under the jar. You get alerts at 25/50/75/100%, and **I bought it!** takes the price out of your savings.
- **Lofi music, generated live**: jazzy chords, swung drums, tape wobble, vinyl crackle and optional rain. It's made with the Web Audio API, so there are no audio files and no copyright problems.
- **Cute cat coworker**: types while you work, wears headphones when music plays, and sleeps when you pause. You can pick its fur colour.
- **Burnout-friendly**: break reminders (25/50/90 min), encouraging messages, a day streak and a 7-day chart.
- Live earnings show in the tab title (and on the extension icon badge). **Space** starts or pauses.
- Everything stays on your device in `localStorage`. You can export and import a backup.

## Use it as a website

Open `coinjar/index.html`. On GitHub Pages it's at `https://<your-site>/coinjar/`.

## Install as a Chrome / Edge extension

1. Go to `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this `coinjar` folder.
4. Pin the 🫙 icon. Clicking it opens Coin Jar in a tab, and the badge shows what you're earning.

Keep the Coin Jar tab open while you work: the music and coins run in that tab.
If you close it with the timer running, it asks next time whether to count the time you were away.
