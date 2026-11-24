# chimeloop-ads

Posting queue for Chimeloop ad videos. Buffer only accepts public media URLs,
so videos are served from this repo via GitHub Pages.

- `posts/<yyyy-mm-dd-slug>/video.mp4` + `caption.md` — the queue, posted in folder-name order,
  one per day at 19:00 (Turkey) to Instagram Reels, TikTok and YouTube Shorts.
- `post-daily.mjs` — run daily by the Windows task "Chimeloop Daily Ads". It pulls this repo,
  imports new renders from `../NeonPulse/marketing/posts`, and keeps the next 3 days scheduled in Buffer.
- `v/` — old video URLs used by the first three scheduled posts (25–27 Nov 2026); safe to delete after they are sent.

## Adding a video from any machine (e.g. Mac)

Render it with the NeonPulse marketing pipeline, then either:

```sh
node post-daily.mjs --import /path/to/NeonPulse/marketing/posts   # copies new folders, commits, pushes
```

or copy `video.mp4` + `caption.md` into `posts/<yyyy-mm-dd-slug>/` yourself and `git push`.
The Windows task picks it up on its next run. Only `--import` and `git` are needed for this;
Buffer posting runs on the Windows machine.

## Checking status

`BUFFER_API_KEY=... node post-daily.mjs --status` (any machine), or the Buffer dashboard.
`state.json` and `posting.log` are machine-local and gitignored.
