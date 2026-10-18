# Privacy policy: Hide Gambling Content

Last updated: 18 October 2026

Hide Gambling Content is a browser extension that hides gambling videos,
streams and channels on YouTube. This policy describes what data it handles.

## Summary

The extension has no server of its own. It does not collect, sell or share
any personal data, it contains no analytics or tracking, and nothing it reads
or stores is ever sent to the developer.

## What is read

On www.youtube.com and m.youtube.com the extension reads video titles,
channel names and any description text shown on the page, in order to
decide which videos to hide. This happens inside your browser. Of this text
only what is listed under "What is stored" is kept, and only what is listed
under "What is sent to YouTube" leaves your browser.

## What is stored

Stored locally in your browser (`storage.local`), never synced or uploaded:

- your settings (on/off switches, keyword languages, score threshold),
- your own keywords,
- your blocked and never-hide channel lists,
- for channels whose videos were hidden by keywords: the channel's name and
  handle, the IDs of those videos (up to 10 per channel), the last hidden
  title and a hit count, used to suggest channels for blocking,
- a cache of which channel posted a Short,
- a log of the reports sent to YouTube (see below), shown in Settings.

Uninstalling the extension deletes all of it. Settings → Backup → Export
writes it to a file only when you click it.

## What is sent to YouTube

The extension talks only to YouTube, and only in these two cases:

1. **Shorts channel lookup.** Shorts cards do not show who posted them, so
   the extension asks YouTube's public oEmbed endpoint
   (`youtube.com/oembed`) for the channel of a Short. The request contains the
   Short's video ID and carries no login or cookies.
2. **"Don't recommend channel" / "Not interested".** For channels you block,
   and, if you turn on **Tell YouTube too**, for videos the extension hides on
   its own, the extension sends YouTube the same feedback request that
   YouTube's own ⋮ menu sends. The request goes to YouTube from the YouTube
   page you have open, signed in as you, using the session YouTube already
   has in that page. The extension does not store, copy or send your login
   or cookies anywhere else. Nothing is sent while you are signed out.

Data sent to YouTube is handled under
[Google's privacy policy](https://policies.google.com/privacy). You can
review or delete the feedback in Google My Activity (Other activity →
YouTube "Not interested" feedback).

## Permissions

- `storage`: to keep the data listed under "What is stored".
- Access to www.youtube.com and m.youtube.com: to read and hide videos on
  YouTube pages. The extension runs on no other site.

## Changes

Changes to this policy are published in this file, in the extension's
public repository.

## Contact

Questions: open an issue at
https://github.com/QuarkOnRails/hide_gambling_content/issues
