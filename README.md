# שורשים — a living family archive

A Hebrew, right-to-left web application for keeping a family's tree, timeline
and heirlooms in one place. Built from a design prototype into a working
full-stack app: React on the front, an Express + Postgres API behind it.

**The tree is the app.** It answers at `/`, it is what you land on, and opening
a person happens inside it rather than by leaving it. Around that: the timeline,
the archive, a person's full page, the join flow, and an editing workshop where
every record in the app can be created, corrected or removed.

---

## Running it

Needs Node 20.11+ and a Postgres you can reach.

```bash
npm install
cp .env.example .env          # set DATABASE_URL; the rest works as shipped
npm run dev                   # API on :4000, client on :5173
```

Open <http://localhost:5173>. The sample Leibovitz–Hirsch family is loaded so
there is something to look at.

For a production run on one machine, the API also serves the built client from
a single port:

```bash
npm run build
SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")" \
  NODE_ENV=production npm start   # everything on :4000
```

**The tables create themselves.** The first request to reach the API applies
the schema and loads the sample family, behind a Postgres advisory lock, so
there is no setup command to run and nothing to do from a machine you may not
have. Several instances cold-starting at once is the case the lock is there
for: one does the work, the rest wait and then find it already done. Verified
with five separate processes against an empty database — seeded exactly once.

`npm run db:migrate` does the same thing on demand, for when you would rather
it happened before a deploy goes live than on the first visitor's request.

### Other commands

| Command | What it does |
| --- | --- |
| `npm run typecheck` | TypeScript across both packages |
| `npm run build` | Bundles the API and builds the client |
| `npm run db:migrate` | Applies the schema and seeds now, rather than on first request |
| `npm run db:reset -- --yes` | Drops every table and rebuilds from schema + seed |
| `npm run fonts:fetch -w client` | Re-downloads the self-hosted font subsets |

---

## Layout

```
shared/types.ts     Domain contract. Types only, so it erases at compile time
                    and neither package needs runtime resolution for it.

api/                Vercel's functions. Every file hands the request to the
                    same handler (server/src/vercel.ts); the bracket names
                    spell out the path depths the API uses — see "Deploying".

server/
  src/app.ts        The Express app, binding nothing
  src/index.ts      The long-running server: app.listen
  src/db/           Schema, pool, named-parameter binding, migrate, seed
  src/repos/        Data access — the only place SQL lives
  src/routes/       HTTP surface, one router per area
  src/middleware/   Sessions, roles, error shaping
  src/lib/          Cohorts, ids, request helpers, upload storage

client/
  src/api/          fetch wrapper + TanStack Query hooks
  src/lib/          Tree geometry, pan/zoom, formatting
  src/components/   Shell, sheets, the lens, avatar, feedback states
  src/screens/      One file per screen, with a CSS module each
  src/styles/       Design tokens and global rules
```

---

## Deploying to Vercel

`git push` deploys. The pieces:

| | |
| --- | --- |
| `vercel.json` | Builds the client, routes `/api/*` to the function and everything else to the SPA |
| `api/*` | The functions. Each one hands the request to `server/src/vercel.ts` |
| `server/src/app.ts` | The app with no listener. Imported from source, so the deploy never depends on a build artifact existing at the moment functions are compiled |

**Why four files under `api/` rather than one catch-all.** The `api` directory
convention has no catch-all. Vercel reads any `[name]` segment — `[...path]`
included, because the brackets are all it looks at — and compiles it to
`([^/]+)`, which is one segment. `api/[...path].ts` therefore served `/api/tree`
and left `/api/auth/session` to the platform's own HTML 404. The client could
only report that as "the request failed": it never reached the API to be given
a real message, and since the session endpoint is what says who you are, the
whole archive read as signed-out and the workshop offered its own owner a
"join" button.

So each depth gets a file — `api/[a].ts` through `api/[a]/[b]/[c]/[d].ts` — and
every dynamic segment at the same position must carry the *same* name. Two
files that disagree about a position's name are rejected at build time as
conflicting paths. A route five segments deep needs
`api/[a]/[b]/[c]/[d]/[e].ts` beside them.

### First deploy

**Import the repository and deploy before setting anything up.** The build will
succeed and the API will fail, because there is no database yet — that is the
expected middle state, and doing it in this order means the storage connections
can inject their own variables rather than being hunted for in a console.

**Then, in the project's Storage tab, connect a Postgres and a Blob store.**
That is what sets `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN`; neither should be
typed in by hand. If the provider offers both a pooled and a direct connection
string, the integration wires up the pooled one, which is what a deployment of
many short-lived instances needs.

**Add the two variables that are genuinely yours**, for all environments:

```
SESSION_SECRET   48 random bytes
STORAGE_DRIVER   blob
```

`NODE_ENV` is set by the platform.

**Redeploy.** The first request creates the tables and loads the sample family
by itself — there is no migration step to run, and nothing to do from a
terminal.

`/api/health` is the check. It answers whatever else is broken, and reports the
database, the upload store, and anything missing by name. A fault that stops the
API comes back as `problems`; one that only costs uploads comes back as a
`warning`, because an archive should not refuse to show the family tree over a
photograph store that has not been connected yet.

**The archive is open, and that is the settled decision.** Anyone with the link
reads it and edits it — no account, no code, no roles, and no such thing as a
guest. The link is shared with the family, and a relative who spots a wrong year
on their own card, or on a cousin's, fixes it there and then. The alternative
was that its author could not look at their own work without logging in and
every relative needed onboarding before they could add a photograph.

Because everyone can edit, the interface keeps the editing quiet rather than
absent: there is no `עריכה` tab over the tree, the way into the workshop is the
menu behind the header's one button, and a person's page offers a muted
`עריכת הכרטיס` rather than a filled button competing with their portrait. A
visitor who came only to read is never handed a toolbar; a relative who came to
correct something finds it in one tap.

**The URL is the only thing between a stranger and the family's records, so
treat the link as the secret.** Two things follow from that and are worth
knowing. Nothing is hard-deleted — people, memories, treasures and timeline
events all keep a tombstone and can be restored — *except* a family link, which
is a real row deletion; removing one therefore asks for confirmation first.
And every contribution is attributed to one shared hand rather than to a person,
so the archive records that something changed but not who changed it.

**When you want that to change, set `ACCESS=invite`.** Nothing was removed to
make the archive open. That one variable restores the whole arrangement:
`INVITE_CODE` gates joining, `PUBLIC_READ` gates reading, the first account to
join becomes the `steward` — the only role that can edit other people's records
or archive anything — and everyone after is a member. `/api/health` reports
which mode is in force.

### Why it is shaped this way

**The database is Postgres because the filesystem is not durable.** A serverless
function's disk does not survive the request that wrote to it, so a SQLite file
and a directory of photographs would be lost continually and silently. The
schema moved across almost unchanged — it was already plain portable SQL, with
no `AUTOINCREMENT`, no `strftime` and no `INSERT OR REPLACE`. What changed is
that every read and write is asynchronous.

**Uploads go to a blob store, behind the same permission check.**
`server/src/lib/storage.ts` has two drivers: `disk` for development, so a fresh
clone needs nothing but Postgres, and `blob` for production. `GET /api/media/:id`
still resolves the row first — read access and the tombstone are enforced before
any URL is handed out — and then redirects. The blob host is added to the CSP
only when that driver is in use.

**With the blob driver, the bytes never pass through the API.** The platform
caps a function's request body at about 4.5MB, which a phone photograph
exceeds — an upload routed through the server dies at the platform's edge, as a
413 the server never sees. So the client asks `/api/health` which driver is in
play and, on `blob`, uploads straight to the store: `POST
/api/media/client-upload` authenticates the uploader and mints a short-lived
token carrying the same type and size limits the multipart route enforces, the
browser PUTs the file with it, and `POST /api/media/record` verifies the
claimed URL against the store itself — `head()` with this store's own token —
before the media row is written. The disk driver keeps the original one-request
multipart path; `MAX_UPLOAD_MB` governs both.

**Parameters are bound by name.** `pg` speaks `$1`, and converting several dozen
statements — one of which sets eighteen columns — to hand-counted positions is
exactly the edit where a transposed pair goes unnoticed, because the parameter
*count* still matches. `bind()` in `server/src/db/index.ts` maps `@name` to
positions, reuses a position for a repeated name, and throws on a name with no
matching parameter rather than quietly binding null.

**One caveat worth knowing.** `express-rate-limit` keeps its counters in memory,
so on serverless the limit is per-instance rather than global. It still stops a
single client hammering one instance, but it is not the ceiling it is on a
single long-running process. A shared store would fix it if the archive is ever
opened up more widely.

### Running it somewhere else

Nothing here is Vercel-specific except `vercel.json` and `api/`. Any host
that runs Node and gives you a Postgres URL works with `npm run build && npm
start` — set `STORAGE_DRIVER=disk` with a persistent directory, or keep `blob`.

## The lens — opening a person

Touching a node does not slide a panel in from the edge. A circle grows out of
that node's own position until it fills the screen, the tree behind it pulls
back and goes soft, and the person's file assembles inside the circle.

Four things make it read as one movement rather than as a transition:

**The origin is measured, not assumed.** `originFromElement` takes the clicked
circle's `getBoundingClientRect` and hands the overlay `--ox`, `--oy` (the
node's centre), `--r0` (its radius) and `--r1` (the distance to the furthest
viewport corner). The clip-path animates between those two radii, so the circle
starts exactly the size of the thing you touched and stops the moment it has
covered the screen — no matter where on the canvas that was, or what the zoom
happened to be.

**The portrait is the same portrait.** A FLIP: the hero image is measured where
it comes to rest, then played back from the offset and scale that put it over
the node. The node's own circle is hidden while the lens is open, so there is
never a copy of it left in the tree to give the trick away.

**The depth of field belongs to the lens.** The blur is a `backdrop-filter` on
the overlay, not a filter on the canvas — so it irises outward with the circle
instead of being applied to a surface several thousand pixels wide. The tree
only takes a `scale` and a desaturation, and it keeps them on the independent
`scale` property, because an animation on `transform` would replace the inline
pan/zoom outright.

**Relatives re-form the lens rather than replacing it.** Parents, partners and
children sit as satellites beside the portrait; touching one measures *that*
circle and opens the next lens from it, gliding the camera underneath so that
closing leaves you looking at whoever you walked to. `?focus=` follows along, so
the URL always names the person on screen.

Closing runs it backwards into the same node. It is a genuine exit animation —
the overlay stays mounted through `lensClose` and unmounts on `animationend`,
since unmounting on click would kill the animation on its first frame.

Arriving on `/` for the first time in a session plays an overture: the derived
headline resolves over the tree while the connectors ink themselves in, then
lifts away. It never takes the pointer, so dragging, zooming and opening a
person all work from the first frame. A `?focus=` link skips it — you came for
a person, not a title card.

## Editing — `/edit`

One place to edit everything, split by what you are editing rather than by
where the data happens to live:

| Tab | Covers |
| --- | --- |
| `/edit/people` | People, their details, portraits, milestones and family links |
| `/edit/treasures` | Every photograph, letter, recording, document, object and story |
| `/edit/timeline` | The family's dated events |

Presented as the card file the rest of the app borrows from: a drawer of
records, each of which unfolds into its own editor. `/edit/people/:id` opens
one directly, so a card is linkable.

**A treasure is created and edited by one component**, `TreasureSheet`, opened
from the archive screen, from the treasures tab, or from a person's own card.
Two entry points that each built their own form would drift; one that only
knew how to *add* would still leave you hunting for somewhere to fix a typo.

**Adding someone asks how they are related before creating them** — child of,
spouse of, parent of, or unlinked. That is both how people actually think about
it and what makes placement work: the server can only auto-place from a birth
year, so it drops a new person at the next free slot in their cohort's row,
which would put a new husband halfway across the board from his wife. Knowing
the relationship first, `client/src/lib/placement.ts` puts a spouse 180px beside
their partner, a first child centred under the couple one row down, and a later
child next to its siblings so the sibling bus stays tight.

Each opened card gives you: a portrait dropzone (uploads immediately, resolves
with the same `develop` wipe as the archive), the core fields, the story,
milestones with inline editing, family links with a relation picker, a D-pad for
nudging the node's position, and — for stewards — archive with a two-step
confirm. Saving is explicit, with an unsaved-changes indicator, rather than a
PATCH per keystroke.

A person's own treasures are listed inside their card, so adding a photograph
of someone happens where you are already thinking about them.

Removed records collect in a drawer at the bottom that only stewards see, since
only stewards can put one back.

Timeline events describe the family rather than one contributor and the table
carries no author, so anyone may add one but amending or removing is
steward-only.

Permissions are the same rules as everywhere else: a member can edit the card
bound to their own account and add people, memories and links. Everyone else's
records are read-only for them, and the editor says so rather than failing at
save time.

## The design language

The app is meant to feel like handling an archive box, not operating a web
form. Two systems carry that, both defined once and used everywhere.

### Motion — `client/src/styles/motion.css`

The easings are **real damped-spring solutions**, not hand-tuned béziers. A
generator samples `x(t) = 1 - e^(-ζωt)(cos(ω_d t) + (ζω/ω_d) sin(ω_d t))` and
emits the result as a CSS `linear()` curve. This matters: a cubic-bezier can
overshoot its target exactly once, whereas a spring rocks past and back several
times, which is what reads as physical rather than merely eased. Three are
defined — a firm one with no overshoot, a settling one with a single rebound,
and a loose one that rocks three times. `--anticipate` goes further and dips
*below* zero before advancing: the animator's anticipation principle, rarely
seen on the web.

Each curve is paired with its own duration token, because a spring played over
the wrong duration stops looking like a spring.

The signature animations are built on them:

| | |
| --- | --- |
| `unfold` | Cards hinge down from their top edge in perspective, like a letter opened flat. The house animation. |
| `develop` | Images wipe in over-exposed and washed out, then resolve to full contrast — a print coming up in the tray. |
| `slot` | Items push out from below already tilted, rotating to their resting angle. |
| `plant` | Tree nodes and portraits wind up, land, and wobble. |
| `ink` | Connectors draw with the nib widening as the line travels. |
| `stamp` | Confirmations land oversized and blurred, then thump down at an angle. |
| `lensOpen` / `lensClose` | The circle growing out of a node to fill the screen, and collapsing back into it. |
| `land` | The FLIP that flies a node out of the tree into the dossier's portrait. |
| `recede` | The tree pulling back and losing its colour while a lens is open. |
| `deal` | A milestone card dealt onto the table, over-rotated and swinging to rest. |
| `orbit` | A relative's satellite spinning up into its place beside the portrait. |

### Referencing them from a CSS module — `global(name)`

Write `animation: global(unfold) 500ms …` inside a `.module.css`, never
`animation: unfold 500ms …`.

Vite's CSS-modules transform rewrites **every** identifier in an `animation`
value to that module's scoped name, whether or not the keyframes are declared
locally. `animation: unfold` compiles to `animation: _unfold_a1b2c_3`, which
matches nothing: the keyframes live in `motion.css`, a plain global stylesheet,
and keep their real names. Nothing errors and the build stays green — the
animation simply never runs, and only in the production build, which is exactly
how it goes unnoticed. `global()` is the transform's own escape hatch and emits
the bare name. A keyframe genuinely declared inside a module (there is one,
`tumble` in `Feedback.module.css`) must be referenced without it.

### Material

Surfaces are paper. Shadows come in two layers — a tight contact shadow pinning
the object down plus a wide soft one for the lift — because a single blurred
shadow is what makes stock cards look like they float in a vacuum. A fixed
layer of fractal noise sits over the whole app at 4% opacity, which is what
stops the large flat cream fields from reading as flat screen colour.

Cards carry a permanent resting tilt seeded from their own id, so a feed reads
as loose prints rather than a grid, and never twitches between renders.
Photographs and documents get a strip of gummed tape; hovering one straightens
and lifts it, the way you would pick a photograph up off a table. Milestones are
index cards with a coloured spine on the bound edge and square corners there,
rounded opposite. Archive filters are the tabs on a card file. The modal is a
drawer with a four-colour band across its front edge.

**Browser support note:** `linear()` easing needs Chrome 113+, Safari 17.4+ or
Firefox 112+ (all shipped in 2023). Older browsers drop the declaration and fall
back to the default ease — the animation still plays, it just loses the rebound.

The lens adds three more of roughly that vintage, each of which degrades to
something sensible rather than to nothing: `color-mix()` (a fallback `background`
is declared first, so the wash goes fully opaque instead of translucent),
`backdrop-filter` (the depth of field is simply absent), and the independent
`scale` property (the tree stops pulling back). Everything else here is
long-standing CSS.

**Reduced motion:** the whole vocabulary collapses to a single instant frame
under `prefers-reduced-motion`, with fill modes intact so nothing that animates
in is left invisible, and the filters and clip-paths are dropped entirely. This
is verified in the smoke run, not assumed.

## Notable decisions

**The tree draws itself from relationships.** The prototype carried hand-written
SVG paths, so the tree broke the moment anybody was added. `client/src/lib/tree-layout.ts`
derives the same shapes — spouse bar, trunk from the couple's midpoint, sibling
bus, drop to each child — from `people` plus `relationships`. Given the sample
family it reproduces the original artwork's paths exactly, and it keeps working
when the family grows.

**Nothing is ever hard-deleted.** People, memories and archive entries carry an
`archived_at` tombstone. An heirloom archive that can silently lose a letter is
worse than one that keeps some clutter, and a mistaken removal stays
recoverable.

**Roles.** The first account to join becomes the `steward`; everyone after is a
`member`. Members read everything, add people, memories and treasures, and edit
their own card. Editing anyone else's record, or archiving one, is steward-only.

**Reads are open by default.** `PUBLIC_READ=true` suits an archive shared by
private link. Set `INVITE_CODE` to gate joining, or `PUBLIC_READ=false` to make
the whole thing private.

**Uploads.** Stored under a random name that never derives from the upload,
behind a MIME allow-list. SVG is deliberately excluded — it can carry script and
would be served from the app's own origin. Anything that is not an image or
audio file is sent as a download rather than rendered inline.

**Fonts are self-hosted.** Heebo and Suez One subsets (hebrew + latin) live in
`client/public/fonts`, so no request leaves the app at runtime and the
Content-Security-Policy needs no third-party origin. Both are under the SIL Open
Font License 1.1.

---

## Where this departs from the prototype

Each of these was a deliberate change, not an oversight:

- **Age labels are computed, not stored.** The mockup hard-coded strings like
  "81–98", which silently go stale. They are now derived from the current year.
- **The youngest cohort is open-ended.** The mockup stopped at 2024, so anyone
  born later fell through to a fallback. There is no settled Hebrew name for the
  cohort after דור האלפא, so rather than invent one the range simply stays open.
- **Year ranges are bidi-isolated.** "1924–2009" has no strong directional
  character, so inside RTL text the numbers swapped and the page read
  "2009–1924". `components/Years.tsx` pins the order.
- **Timeline cards are packed into four rows.** Strict above/below alternation
  collides once two events fall within about nine years — and the sample family
  has six between 1933 and 1952.
- **The recording player is honest.** The mockup showed a fixed "04:12 / 12:40"
  progress bar. A real `<audio>` element appears when a recording has been
  uploaded; otherwise the card says so and points at the upload flow.
- **The hero headline is derived, and it plays over the tree.** "מלודז׳ וברלין,
  עד אלינו" is built from the founding row's places, so it still tells the truth
  for a different family. The mockup gave it a home screen of its own; a page
  *about* the tree in front of the tree is one screen too many, so the line is
  now the overture that opens over the real thing.
- **A person opens in place.** The mockup popped a small card under the node
  with the name, the years and a link. That card is gone: the name plate under
  every node already carries what it said, and touching a node now opens the
  lens.
- **Full-viewport rather than a phone frame.** The mockup rendered inside a
  432×896 device shell. The tree in particular wants the room; the layout is
  responsive from 390px up.

---

## Notes and open points

- **The sample family is fiction from the design**, not a real genealogy. It is
  ordinary editable data — replace or archive it as real records arrive.
- **Uploads are validated by declared MIME type and extension**, not by
  inspecting file contents. Combined with `nosniff`, a random stored filename
  and an attachment fallback that is a reasonable posture for a family-sized,
  invite-gated deployment. Content sniffing would be the next hardening step if
  the archive is ever opened more widely.
- **State lives in Postgres and in the blob store**, not in the repo.
  `server/data/` is only used by the `disk` upload driver in development, and is
  git-ignored. Back up the database and the blob store; nothing in the repo is
  stateful.
- **There is no automated test suite yet.** Verification so far is a browser
  smoke run over every screen plus the join, upload, memory, editing and lens
  flows — including a pass under `prefers-reduced-motion` and one at 390px —
  driven against a real Postgres. Unit tests around `tree-layout.ts`,
  `placement.ts`, `bind()` and the permission checks would be the highest-value
  place to start.
- **The blob driver's token handshake is verified locally; the store round-trip
  is not.** Minting the client-upload token is local HMAC work and is exercised
  against the real routes (limits, pathname guard, refusal paths, and the token's
  embedded constraints were all checked by calling them); the PUT to Vercel Blob
  itself and the `head()` verification behind `/api/media/record` still need one
  pass against a connected store. The disk driver's multipart path is covered
  end to end, through the browser.
- **Nothing catches a CSS animation that references a keyframe which is not
  there.** It was possible to ship the entire motion vocabulary dead in the
  production bundle for as long as it took to look for it (see `global(name)`
  above). A build step that cross-checks every `animation:` identifier in the
  emitted CSS against the `@keyframes` it declares would be cheap and would have
  caught it on the first build.
- **Schema changes need a line in `ensureColumn`.** `CREATE TABLE IF NOT EXISTS`
  leaves an existing table alone, so a column added to `schema.sql` has no
  effect on a database that already holds records. `server/src/db/index.ts`
  applies missing columns idempotently at boot; add to it rather than assuming
  the schema file is enough.
