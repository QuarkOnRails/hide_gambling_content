# Hide Gambling Content

A browser extension for Chrome and Firefox that hides gambling content on
YouTube: casino and slot streams, betting tips and gambling-operator
promotions. It works on the home feed, search results, the sidebar next to a
video, channel pages, Shorts and the end screen.

![The toolbar popup](store/screenshot-1-popup.png)

## Install

### Chrome, Edge, Brave and other Chromium browsers

**Chrome Web Store:** coming soon.

Until then you can install it by hand (Chrome 111 or newer):

1. On this page, click **Code** → **Download ZIP**, and unzip it.
2. Open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped folder.

Chrome shows a warning about `browser_specific_settings`. That setting is for
Firefox and the warning is harmless.

### Firefox (128 or newer)

Not on addons.mozilla.org yet. To try it:

1. Download and unzip it as above.
2. Open `about:debugging`, click **This Firefox** → **Load Temporary
   Add-on…** and pick `manifest.json` in the unzipped folder.

Firefox removes temporary add-ons when it restarts.

After installing, reload any YouTube tabs that were already open.

## How it decides what to hide

- **Keywords** in nine languages (English, Czech, Slovak, German, Polish,
  Russian, Spanish, Portuguese, Turkish), plus names of gambling operators
  and slot games. Each video gets a score: strong words such as "casino" or
  "free spins" hide a video on their own, while ambiguous words such as
  "slot", "jackpot" or "bonus" need a second hit. Exceptions keep things like
  "Casino Royale" or "PCIe slot" visible.
- **Channels**: a built-in list of gambling channels, your own blocklist,
  and any channel whose name contains words like "casino", "jackpot" or
  "slots".
- **Suggestions**: a channel whose videos keep getting hidden by keywords is
  suggested for your blocklist. Nothing is blocked without your click.

It reads the video title, the channel name and the description when YouTube
shows one. Fancy lettering such as 𝐂𝐀𝐒𝐈𝐍𝐎, accents and hidden characters
don't get past it.

Channels on your **Never hide** list are always shown, whatever their videos
are called.

## Using it

### The toolbar popup

Click the extension's icon to:

- turn hiding on or off,
- see how many videos are hidden on the current page,
- **Block** or **Never hide** the channel you are looking at (on a video,
  Short or channel page),
- switch **Guard opened videos** and **Tell YouTube too**,
- open **Settings**.

### Guard opened videos

On by default. It covers videos you land on directly, for example from a
link. A matching Short is skipped automatically, in the direction you were
scrolling. A matching normal video is paused and blacked out; a small
**Show** button in the corner lets you watch it anyway if it was hidden by
mistake.

### Settings

- **General**: hiding on or off, Guard opened videos, Tell YouTube too, and
  the score needed to hide (default 2; higher hides less).
- **Keyword languages**: turn off languages you don't need.
- **Try a title**: paste any video title, and optionally a channel name, to
  see whether it would be hidden and which words counted.
- **Your keywords**: add your own strong words, weak words, exceptions and
  channel-name words (see below).
- **Suggested channels**, **Blocked channels** and **Never hide**: your
  channel lists. To add a channel, type its @handle, its URL, its channel ID
  (UC…) or its exact name.
- **Reported to YouTube**: everything the extension has told your YouTube
  account.
- **Backup**: export your keywords, lists and settings as a file, and import
  them again. This is also how you move them between Chrome and Firefox.

### Writing your own keywords

One entry per line. Upper and lower case and accents don't matter.

| Entry         | Meaning                                                    |
| ------------- | ---------------------------------------------------------- |
| `bonus buy`   | a phrase; also matches `bonus-buy`, `bonusbuy`, `bonus, buy` |
| `slot\|slots` | variants of one word, counted once per title               |
| `sázkař*`     | a trailing `*` allows any ending                           |

- **Strong** words hide a video on their own (2 points).
- **Weak** words need a second hit (1 point).
- **Exceptions** are phrases that are ignored, so their words don't count.
- **Channel name contains** blocks every channel whose name or handle
  contains the word, even inside glued words: `jackpot` blocks
  "JackpotJudo".

## Telling YouTube

Hiding only works in the browser where the extension is installed. To reach
the YouTube app on your phone too, the extension can tell your YouTube
account what it hid. It uses the same feedback as YouTube's own ⋮ menu:

| Hidden because                        | YouTube is told          | When                        |
| ------------------------------------- | ------------------------ | --------------------------- |
| you blocked the channel               | Don't recommend channel  | always                      |
| channel on the built-in list          | Don't recommend channel  | with **Tell YouTube too**   |
| channel name contains a channel word  | Don't recommend channel  | with **Tell YouTube too**   |
| title or description keywords only    | Not interested (video)   | with **Tell YouTube too**   |

**Tell YouTube too** is off by default.

- Reports are sent only from your **home feed**. So a channel you block is
  reported the next time one of its videos shows up in your home feed; until
  then Settings shows it as "YouTube not told yet".
- Each channel and video is reported once, at most one report every 3
  seconds and 30 a day. Channels on your Never hide list are never reported.
  Nothing is sent while you are signed out.
- If YouTube refuses a report, reporting stops in that tab and the popup
  tells you. Hiding keeps working.
- Removing a channel from your blocklist does not undo the report on
  YouTube. To undo it, delete the entry in
  [Google My Activity](https://myactivity.google.com/) under Other activity →
  YouTube "Not interested" feedback.

## Privacy

Everything runs in your browser. There is no account, no analytics and no
server of its own. The extension talks only to YouTube: to look up who posted
a Short (without your login), and to send the feedback described above (as
you). It needs only two permissions: storage for your settings and lists,
and access to youtube.com. Details in the [privacy policy](PRIVACY.md).

## Something slipped through, or a harmless video got hidden

YouTube changes its pages often, so this can happen.

- **A gambling video is still shown.** Paste its title into Settings → **Try
  a title**. If it would be hidden, YouTube has changed its page and the
  extension needs an update: please
  [open an issue](https://github.com/QuarkOnRails/hide_gambling_content/issues)
  and say where on YouTube it was. If it would not be hidden, add one of its
  words under **Your keywords**, or block the channel.
- **A harmless video is hidden.** Paste its title and channel into **Try a
  title** to see which words counted. Then add the phrase as an exception,
  or put the channel on **Never hide**.

## Limits

- Home-feed cards and Shorts show no description, so a video whose only
  gambling mention is in its description is hidden there only once you open
  it. Tags and the video itself are never checked.
- Shorts don't show their channel, so the extension asks YouTube who posted
  each one. A Short stays invisible for a moment until YouTube answers.
- The YouTube apps on phones and TVs can't run extensions. **Tell YouTube
  too** is the way to reduce gambling content there. Firefox for Android can
  run the extension on m.youtube.com, on a best-effort basis.

## Support

- Bugs and ideas:
  [GitHub issues](https://github.com/QuarkOnRails/hide_gambling_content/issues)
- If the extension helps you, you can
  [buy me a coffee](https://buymeacoffee.com/quarkonrails) ☕

Want to change the code or the keyword lists? See
[DEVELOPMENT.md](DEVELOPMENT.md).
