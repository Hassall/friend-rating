# Friend Rating

A desktop-first party game for a host and up to 20 invited friends.

Play online at https://friendrating.pages.dev.

## Run locally

Use Node.js 24 or later. From this folder, run `node scripts/dev.mjs` and open
http://127.0.0.1:4173. Test with a second browser profile or private window so
each player has their own player pass. The local server stores rooms in
`.local/rooms.sqlite`.

## Play

1. Create a room, copy its invite link, and start once everyone has joined.
2. The host sets how long players have to lock in ten traits. The default is
   two minutes. You can review or unlock
   your picks until the timer expires or everyone locks in. Only locked picks
   count. The ten most popular traits go through, with alphabetical tiebreaks
   for traits that received votes. Preset traits fill any remaining slots.
3. Each friend gets a two-minute turn. Everyone else uses the +5 and −5
   controls to give out 100 points. Split evenly sets all traits to 10.
   Fill remaining divides the leftover budget in five-point chunks among
   traits already given points, or among all ten when the ballot is empty.
4. Lock in the vote before the timer reaches zero. You can review or unlock it
   while the round is open. The timer or the last eligible lock closes the
   round, then a four-second countdown leads to the next player or the rankings.
5. The host can enable either or both optional rounds before starting.
   Guests can see the timer and optional rounds selected in the lobby.
   **Most Likely To** presents ten random questions, one at a time. Everyone
   votes for one player per question. **Guess the Winners** asks up to ten
   questions about the trait results and, when available, the Most Likely To
   votes. A five-second countdown introduces the round. Each correct
   prediction earns one point, and any tied winner counts.
   Each question gives players 30 seconds or advances when everyone locks in.
6. The game reveals up to three players per trait, along with their average
   points per vote. Tied players share a rank, with join order breaking ties
   for the last slot. The recap shows every player’s chart on a common
   scale. Select a chart to view exact scores. The recap also shows the
   winners of each Most Likely To question and the guessing leaderboard.

The short invite link admits anyone holding it while the lobby is open.
On the hosted site, is.gd redirects to the public homepage. The browser
carries the room code in the URL fragment after the redirect. The lobby
also offers a direct link.
Room state lives on the server. Closing a tab keeps your seat and lets you
rejoin from the same browser. In the lobby, an active player becomes host
if the host has been away for about a minute. Once the game starts, the
timers advance independently of the host.

**Leave room** frees your seat. If the host leaves, the first remaining
player takes over. A departing player is skipped in future rounds, and
closed rounds keep their scores. The room closes when the last player leaves.
An unstarted room expires after 15 minutes. A started game has a one-hour
limit plus five minutes per enabled optional round. Its recap expires
10 minutes after the rankings finish or at the
game limit, whichever comes first. The server allows six creations per
network address per clock hour and removes expired records as rooms are created.

## Site activity

The owner can sign in at `/admin` to see live room and player counts alongside
site-wide activity for the last 30 days. Live counts include room members seen
within the last minute. A random ID saved in the browser helps count players
once across rooms on the same browser; it is not an account or a room pass.
The dashboard refreshes every 15 seconds while open and shows totals,
a 14-day trend, completion rate, and breakdowns by country, game length, group
size, and optional rounds. The activity API returns aggregates only. New
activity records do not store display names. Country is recorded when the
hosting edge supplies it. Set the hosted secret `FRIEND_RATING_OWNER_EMAIL` to
the owner’s ChatGPT sign-in email.

## Build

Run `node scripts/build.mjs` to produce the Sites Worker at
`dist/server/index.js`. Hosting uses the `DB` D1 binding and the SQL migration
in `drizzle/`. For internet play, the hosting audience must allow each invited
friend to load the app, and the individual room URL controls entry to the game.

Run `node scripts/build-pages.mjs` and upload the contents of `dist/pages`
to the `friendrating` Cloudflare Pages project when updating the public
frontend. Pages uses the Sites room API and sends `/admin` to the existing
owner dashboard. Publish the Sites Worker when the API changes.
