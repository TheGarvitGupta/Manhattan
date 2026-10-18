# Cadence

Which songs make you run faster? Cadence lines up Strava runs and rides with
Spotify listening history and shows how pace (or, on a bike, speed) moves with
the music.

Lives at `www.garvitgupta.com/cadence` as a Cloudflare Worker routed onto the
main site. (This repo used to be called Manhattan; the 2020 Flask prototype is
in git history before commit 6754ada.)

## How it works

- **Sign-in** is "Connect with Strava". Spotify is connected as a second step.
- **A cron trigger** runs every 10 minutes: it saves each user's recent Spotify
  plays (Spotify only exposes the last 50, so this has to be frequent) and
  looks for new Strava runs. A Strava webhook makes new runs appear at once.
- **Matching** (`src/match.ts`) works out which song was playing during which
  stretch of a run, from the run's per-second distance stream.
- **Insights** (`src/insights.ts`) compare each song with the pace of the run
  it played on, so a song isn't "slow" just because it comes up on easy days.
- **Running and biking** are analysed apart, automatically. Rides live in the
  `runs` table beside runs, told apart by `sport` ('run' or 'ride'); e-bike
  rides are left out. Signed in, a Running / Biking tab turns between the two
  analyses, and each needs its own five activities with music.

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
brand/             logo, wordmark and contact card (not served)
```

## Run it locally

```sh
npm install
npm run db:migrate      # create the local database
npm run simulate        # load a simulated runner
npm run dev             # http://127.0.0.1:8787/cadence/
```

Choose **See the demo** to browse the simulated data. No API keys needed.

`npm run simulate -- --runs 120 --rides 60 --weeks 40 --seed 7` makes a different one.
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

## Emails

Strava does not share an email address, so a new account is asked for one
before anything else, and picks how often to hear from Cadence: Sundays only,
or Sundays plus a note after every run or ride. Written in `src/emails.ts`,
from `Cadence <no-reply@cadence.garvitgupta.com>`:

- **Welcome**: once, when someone gives an address. It carries the
  "Confirm my email" button; nothing else is sent until they tap it.
- **After each run or ride** (if they asked): about 20 minutes after it ends,
  only if music was playing. The route on a map with each song's stretch in its
  own colour, every song with its pace or speed, then that sport's findings (or
  how many more activities it needs). The map is drawn by Mapbox's Static
  Images API and served through the Worker (`src/staticmap.ts`), on a signed
  link, so the token never appears in an email.
- **Sunday roundup**: 9am every Sunday in the reader's timezone. Their last 10
  songs and last 10 runs and rides (each with its songs) while Cadence is still collecting, or the top findings
  once there are five runs with music. Biking joins the same email on the same
  terms: its findings appear once there are five rides with music, and until
  then the email says how many there are so far.

Turning emails off (on the Emails page, or from a link in any email) keeps the
address. The Emails page shows each email filled in with the account's own data
(or the demo runner's, until there is some), and when each was last sent.

Emails go out through Resend (resend.com, free at this volume). Sending is off
until it is set up:

1. In Resend, add the domain `cadence.garvitgupta.com` and add the DNS records
   it shows to Cloudflare DNS. They sit on the `cadence` subdomain only, so the
   iCloud mail on `garvitgupta.com` is not affected.
2. Create a Resend API key and store it: `npx wrangler secret put RESEND_API_KEY`.

Until the key exists the Emails page shows previews only. `.dev.vars` can hold
the same key for local testing.

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
