# Friend Rating

A desktop-first party game for a host and up to 20 invited friends.

Play online at https://friend-rating-after-hours.corkyravioli5.chatgpt.site.

## Run locally

Use Node.js 24 or later. From this folder, run `node scripts/dev.mjs` and open
http://127.0.0.1:4173. Test with a second browser profile or private window so
each player has their own player pass. The local server stores rooms in
`.local/rooms.sqlite`.

## Play

1. Create a room, copy its invite link, and start once everyone has joined.
2. Each player submits exactly ten traits. The ten traits with the most picks
   go through. A tie at the cutoff is resolved alphabetically.
3. Each friend gets a 30-second turn. Everyone else can type whole numbers or
   use the +5 and −5 controls to split 100 points. Split evenly sets all
   traits to 10. Fill remaining divides the leftover budget among traits
   already given points, or among all ten when the ballot is empty.
4. Lock in the vote before the timer reaches zero. Only locked votes count.
5. The game reveals up to three players per trait, along with their average
   points per vote. Tied players share a rank, with join order breaking ties
   for the last slot. The recap shows every player’s chart on a common
   scale. Select a chart to view exact scores.

The server enforces the invite limit, stage changes, and voting rules. The
lobby is open to anyone with its room URL until the host starts. Players
returning in the same browser can reconnect with their existing player pass.

## Build

Run `node scripts/build.mjs` to produce the Sites Worker at
`dist/server/index.js`. Hosting uses the `DB` D1 binding and the SQL migration
in `drizzle/`. For internet play, the hosting audience must allow each invited
friend to load the app, and the individual room URL controls entry to the game.
