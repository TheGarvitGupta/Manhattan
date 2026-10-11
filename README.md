# Cadence

Which songs make you run faster? Cadence lines up Strava runs with Spotify
listening history and shows how pace moves with the music.

Lives at `www.garvitgupta.com/cadence` as a Cloudflare Worker routed onto the
main site. (This repo used to be called Manhattan; the 2020 Flask prototype is
still in the root as `*.py`.)

## How it works

- **Sign-in** is "Connect with Strava". Spotify is connected as a second step.
- **A cron trigger** runs every 10 minutes: it saves each user's recent Spotify
  plays (Spotify only exposes the last 50, so this has to be frequent) and
  looks for new Strava runs. A Strava webhook makes new runs appear at once.
- **Matching** (`src/match.ts`) works out which song was playing during which
  stretch of a run, from the run's per-second distance stream.
- **Insights** (`src/insights.ts`) compare each song with the pace of the run
  it played on, so a song isn't "slow" just because it comes up on easy days.

Cadence can only match songs it saw at the time, so data builds from the day
someone connects Spotify. Past runs can't be backfilled.

```
src/index.ts       routes, sessions, OAuth callbacks, webhook, cron entry
src/providers.ts   Strava + Spotify OAuth and API calls
src/sync.ts        background sync
src/match.ts       songs -> stretches of a run
src/insights.ts    the correlations
public/cadence/    the front end (plain HTML/CSS/JS, no build step)
migrations/        D1 schema
scripts/simulate.ts  simulated runner for the demo
```

## Run it locally

```sh
npm install
npm run db:migrate      # create the local database
npm run simulate        # load a simulated runner
npm run dev             # http://127.0.0.1:8787/cadence/
```

Choose **See the demo** to browse the simulated data. No API keys needed.

`npm run simulate -- --runs 120 --weeks 40 --seed 7` makes a different runner.
The script prints which songs it made fast and slow, so you can check the
dashboard finds them.

To sign in for real locally, put the two client secrets in `.dev.vars` (see
`.dev.vars.example`) and add these redirect settings:

- Strava (strava.com/settings/api): Authorization Callback Domain `127.0.0.1`
  while testing locally. Strava allows only one domain; switch it to
  `www.garvitgupta.com` for production.
- Spotify (developer.spotify.com/dashboard): add Redirect URI
  `http://127.0.0.1:8787/cadence/auth/spotify/callback`

To run the background sync by hand: `curl "http://127.0.0.1:8787/__scheduled"`.

## Deploy to Cloudflare

One-time setup:

```sh
npx wrangler login
npx wrangler d1 create cadence          # paste the printed database_id into wrangler.jsonc
npm run db:migrate:remote
npx wrangler secret put STRAVA_CLIENT_SECRET
npx wrangler secret put SPOTIFY_CLIENT_SECRET
npx wrangler secret put TOKEN_KEY             # any long random string, e.g. `openssl rand -hex 32`
npx wrangler secret put STRAVA_VERIFY_TOKEN   # any string you make up
npm run deploy
npm run simulate -- --remote            # optional: demo data in production
```

Then:

1. **Strava**: set Authorization Callback Domain to `www.garvitgupta.com`.
2. **Spotify**: add Redirect URI
   `https://www.garvitgupta.com/cadence/auth/spotify/callback`, and add each
   person who will use the app under User Management (see limits below).
3. **Strava webhook** (so runs appear straight away), once:

   ```sh
   curl -X POST https://www.strava.com/api/v3/push_subscriptions \
     -F client_id=38171 -F client_secret=YOUR_STRAVA_SECRET \
     -F callback_url=https://www.garvitgupta.com/cadence/webhooks/strava \
     -F verify_token=YOUR_STRAVA_VERIFY_TOKEN
   ```

   Then raise `STRAVA_POLL_MINUTES` in `wrangler.jsonc` to `360` and redeploy.

The route `www.garvitgupta.com/cadence*` is declared in `wrangler.jsonc`, so
deploying attaches it; nothing needs adding to the website repo. To rename the
app, change the route, `BASE_PATH`, the `run_worker_first` paths and the
`public/cadence` folder name together.

Later deploys are just `npm run deploy` (plus `npm run db:migrate:remote` when
there is a new migration).

## Limits to know about

- **Spotify** app StravaLink is in Development mode: only accounts added under
  User Management can connect, capped at five, and the app owner needs
  Spotify Premium. Opening it to anyone ("extended quota") is only granted to
  registered organisations with 250,000+ monthly users.
- **Strava** app 38171 allows 10 connected athletes and 200 read requests per
  15 minutes (2,000 a day), shared with the website's Strava widget. More
  athletes needs Strava's approval.
- **Workers free plan**: 50 outbound requests and 10 ms CPU per invocation. The
  sync works through users in batches to stay inside this; a busy install
  wants the $5 paid plan.
- `played_at` from Spotify is treated as the moment a track finished. If songs
  look shifted by one track on real runs, flip `PLAYED_AT_IS_END` in
  `src/match.ts`.
