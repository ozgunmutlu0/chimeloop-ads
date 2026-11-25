# chimeloop-ads

Posting queue for Chimeloop ad videos. Buffer only accepts public media URLs,
so videos are served from this repo via GitHub Pages.

- `posts/<yyyy-mm-dd-slug>/video.mp4` + `caption.md` (+ optional `cover.jpg`: the cover baked into the first 0.3 s; Buffer only accepts a frame offset, so posts use that frame) — the queue, posted in folder-name order,
  one per day at 19:00 (Turkey) to Instagram Reels, TikTok and YouTube Shorts.
- `post-daily.mjs` — run daily by the Windows task "Chimeloop Daily Ads". It pulls this repo,
  imports new renders from `../NeonPulse/marketing/posts` (including re-renders of posts not sent yet:
  their scheduled Buffer posts are deleted and recreated at the same time), and keeps the next 3 days scheduled in Buffer.
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

## API key on a new machine

The script reads `BUFFER_API_KEY` from the environment only; never put the key in a file in this repo
(`.env` is gitignored as a safety net). On a Mac, store it in Keychain (prompts, nothing in shell history):

```sh
security add-generic-password -a "$USER" -s buffer-api -w
echo 'export BUFFER_API_KEY="$(security find-generic-password -s buffer-api -w)"' >> ~/.zshrc
```

The free Buffer plan has one key; creating a new one revokes the old one on every machine.
Run the daily scheduler on only one machine at a time (state.json is local), or posts get scheduled twice.
