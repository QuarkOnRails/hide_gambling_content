# Hide Gambling Content

Browser extension that hides gambling content on YouTube: casino and slot
streams, betting tips, operator promotions. One codebase for **Chrome**
(and other Chromium browsers) and **Firefox**.

It combines three signals:

1. **Keywords** in nine languages (English, Czech, Slovak, German, Polish,
   Russian, Spanish, Portuguese, Turkish) plus language-independent operator
   and slot-game names. Keywords are scored: "casino", "gambling" and
   explicit phrases hide on their own, while ambiguous words such as "slot",
   "jackpot" or "bonus" need a second hit.
2. **Channel blocklist**: a bundled JSON list plus your own list.
3. **Feedback loop**: a channel whose videos keep getting caught by keywords
   is suggested for the blocklist. Nothing is blocked without your click.

Everything runs locally and only the `storage` permission is needed. The
extension talks to YouTube itself and to no other server:

- Shorts cards show no channel, so it asks `youtube.com/oembed` who posted a
  Short. Answers are cached. This request carries no login.
- It tells your YouTube account "Don't recommend channel" for channels you
  block, and, with **Tell YouTube too** switched on, "Not interested" or
  "Don't recommend channel" for what it hides on its own. These requests go
  out signed in as you; see [Reporting to YouTube](#reporting-to-youtube).

## Install

### Chrome / Chromium / Edge / Brave (111 or newer)

1. Open `chrome://extensions`, switch on **Developer mode**.
2. **Load unpacked** and pick this folder.

Chrome prints a warning about the unknown key `browser_specific_settings`.
That key is for Firefox and the warning is harmless.

### Firefox (128 or newer)

- For development: `about:debugging` → **This Firefox** → **Load Temporary
  Add-on** → pick `manifest.json`. It stays until Firefox restarts.
- For permanent use Firefox requires a signed add-on: run `npm run package`,
  upload the zip to addons.mozilla.org as an *unlisted* add-on and install the
  signed `.xpi` you get back. Firefox Developer Edition and ESR can instead
  turn off `xpinstall.signatures.required`.

Reload open YouTube tabs after installing.

## Use

- The toolbar popup switches hiding on and off, shows how many videos are
  hidden on the page and lets you block or whitelist the channel you are
  looking at.
- **Guard opened videos** deals with a matching video you land on directly.
  In the Shorts player it is skipped automatically, in the direction you were
  scrolling. A normal video is paused and blacked out without any message; a
  small "Show" button in the corner is the way out of a false positive.
- **Block** (popup or Settings) hides the channel and tells YouTube "Don't
  recommend channel", so the YouTube app on your phone stops recommending it
  too. **Tell YouTube too** (popup, off by default) does the same for what
  the extension hides on its own. See [Reporting to YouTube](#reporting-to-youtube).
- **Settings** has language toggles, your own keywords, both channel lists,
  a box to try a title against the current rules, and import/export. Export
  is how you move your lists between Chrome and Firefox.

## How matching works

Text is normalised first: lowercase, accents removed, look-alike Unicode
letters folded (`𝐂𝐀𝐒𝐈𝐍𝐎` becomes `casino`), invisible characters removed.
Words are matched on Unicode-aware word boundaries, so `bets` does not match
`alphabets`.

Order of evaluation for each card:

1. channel on the **never hide** list → shown,
2. channel on a **blocklist**, or channel name containing a **channel-name
   term** → hidden,
3. **exceptions** are cut out of the text ("Casino Royale", "PCIe slot",
   "ключевая ставка"),
4. score = 2 × distinct strong hits + 1 × distinct weak hits, over the title,
   the channel name and the description when the page shows one. Hidden when the score reaches the threshold
   (default 2).

### Keyword entry syntax

| Entry          | Meaning                                                              |
| -------------- | -------------------------------------------------------------------- |
| `bonus buy`    | phrase; also matches `bonus-buy`, `bonusbuy`, `bonus, buy`           |
| `slot\|slots`  | variants of one concept, counted once per title                      |
| `sázkař*`      | trailing `*` allows any ending                                       |

Files: `data/keywords/<lang>.json` and `data/brands.json`, each with
`strong`, `weak` and `exceptions` arrays. To add a language, add the file
and one line to `LANGUAGES` in `src/store.js`.

### Channel list

`data/channels.json`:

```json
{ "id": "UCDyrCJyFaOLc8OnnCd0Khcg", "handle": "", "name": "Brian Christopher Slots" }
```

A channel is matched by `id`, or by a compact key built from both handle and
name: `MrHandPay`, `@mrhandpay` and `Mr. Hand Pay` are the same channel. So an
entry with only a name is enough, which matters because YouTube cards rarely
show the id. The directory-sourced entries carry ids and names; entries tagged
`user-reported` carry the name only.

### Channel-name terms

The `channel` array in `data/brands.json` (and "Channel name contains" in
Settings) blocks every channel whose name or handle contains a term, also
inside glued words: `jackpot` blocks "JackpotJudo" and `@jackpotjudo`.
Built in: casino (all spellings), jackpot, gambling/gambler/gambles, slots,
bonus hunt, high roller and sports betting. The never-hide list wins over it.

## Reporting to YouTube

Hiding only works in the browser that runs the extension. To reach the
YouTube app on a phone, it also tells your YouTube account what it hid, with the
same request YouTube's own ⋮ menu sends:

| Hidden because                        | Sent                     | When                        |
| ------------------------------------- | ------------------------ | --------------------------- |
| you blocked the channel               | Don't recommend channel  | always                      |
| channel on the built-in list          | Don't recommend channel  | with **Tell YouTube too**   |
| channel name contains a channel term  | Don't recommend channel  | with **Tell YouTube too**   |
| title or description keywords only    | Not interested (video)   | with **Tell YouTube too**   |

- Reports are sent from **home-feed cards** only (including Shorts shown in
  the home feed, which get "Not interested"). So a blocked channel is
  reported the next time one of its videos shows up in your home feed in the
  browser; until then Settings shows it as "YouTube not told yet".
- Each channel and video is reported once, at most one report every 3
  seconds and 30 a day. Never-hide channels are never reported. Nothing is
  sent while signed out.
- If YouTube refuses a report, reporting stops in that tab and the popup says
  so. Hiding keeps working.
- Settings → **Reported to YouTube** lists everything sent. Unblocking a
  channel does not undo it on YouTube; delete the entry in Google My Activity
  (Other activity → YouTube "Not interested" feedback).

How it works: `src/page.js` runs inside YouTube's own page (`"world":
"MAIN"`), because only there is the data YouTube attaches to its cards
visible. It takes the code of the right ⋮ menu entry from a home-feed card's
data (`ytd-rich-item-renderer.data`), only if that entry names exactly the
expected video, and posts it to `/youtubei/v1/feedback`. The content script decides what to report and keeps
the queue. When YouTube changes its data, `ACTION_ICONS` and `cardData()` in
`src/page.js` are the places to fix.

## Development

No build step and no dependencies.

```
npm test               # unit tests (matcher, normalisation, store, report codes, data files)
npm run e2e            # loads the real extension into headless Chromium
npm run lint:firefox   # web-ext lint
npm run package        # dist/hide-gambling-content-<version>.zip
```

The end-to-end test is fully local: it serves `test/e2e/*.html` from
127.0.0.1 and maps `www.youtube.com` to it inside the test browser, including
stand-ins for YouTube's oEmbed and feedback endpoints. Stored settings for a
test case are written through `test/e2e/seed.html`, an extension page that is
not packaged.

Layout:

```
manifest.json
src/normalize.js, matcher.js    pure logic, also runs under Node
src/selectors.js                every YouTube selector
src/extract.js                  DOM -> { videoId, title, channel… }
src/store.js                    storage.local, bundled JSON, feedback loop, Shorts lookup cache
src/content.js, content.css     observer, marking, watch-page guard, report queue
src/page.js                     runs in YouTube's page: sends reports to YouTube
src/popup/, src/options/        UI
data/                           keyword and channel lists
```

There is no background script. Popup, options page and content scripts
share state through `storage.local` and react to `storage.onChanged`.

## When something is not hidden

YouTube changes its markup often.

- a video that should be hidden is shown → open Settings and paste the title
  into **Try a title**. If it scores, the card's markup is not recognised: fix
  `src/selectors.js`. If it does not score, add a keyword.
- a harmless video is hidden → find out why: in the browser's developer tools
  search the Elements panel for `data-restrict-info`; every hidden card carries
  the rule that fired. Then add an exception phrase, or put the channel on the
  never-hide list.

## Limits

- Titles, channel names and any description text shown on the page are read.
  Search results show a description snippet and the watch page shows the
  full description. Home-feed cards and Shorts show none, so a video whose
  only gambling mention is in its description is caught on those surfaces
  only once it is opened. Tags and the video itself are never read.
- Shorts cards carry no channel information, so each Short's channel is looked
  up; the card stays invisible for a moment until YouTube answers. If the
  lookup fails, only title keywords apply to that Short.
- The YouTube mobile apps cannot be filtered. Firefox for Android can run the
  extension on m.youtube.com; the mobile selectors are best effort.
