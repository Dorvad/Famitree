# שורשים — a living family archive

A Hebrew, right-to-left web application for keeping a family's tree, timeline
and heirlooms in one place. Built from a design prototype into a working
full-stack app: React on the front, an Express + SQLite API behind it.

**The tree is the app.** It answers at `/`, it is what you land on, and opening
a person happens inside it rather than by leaving it. Around that: the timeline,
the archive, a person's full page, the join flow, and an editing workshop where
every record in the app can be created, corrected or removed.

---

## Running it

```bash
npm install
cp .env.example .env          # adjust as needed; defaults work for local use
npm run dev                   # API on :4000, client on :5173
```

Open <http://localhost:5173>. On first boot the database is created and seeded
with the sample Leibovitz–Hirsch family so there is something to look at.

For a production run, the API also serves the built client from a single port:

```bash
npm run build
SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")" \
  NODE_ENV=production npm start   # everything on :4000
```

### Other commands

| Command | What it does |
| --- | --- |
| `npm run typecheck` | TypeScript across both packages |
| `npm run build` | Bundles the API and builds the client |
| `npm run db:reset -w server -- --yes` | Rebuilds the database from schema + seed |
| `npm run fonts:fetch -w client` | Re-downloads the self-hosted font subsets |

---

## Layout

```
shared/types.ts     Domain contract. Types only, so it erases at compile time
                    and neither package needs runtime resolution for it.

server/
  src/db/           Schema, connection, seed, reset
  src/repos/        Data access — the only place SQL lives
  src/routes/       HTTP surface, one router per area
  src/middleware/   Sessions, roles, error shaping
  src/lib/          Cohort definitions, ids, request helpers

client/
  src/api/          fetch wrapper + TanStack Query hooks
  src/lib/          Tree geometry, pan/zoom, formatting
  src/components/   Shell, sheets, the lens, avatar, feedback states
  src/screens/      One file per screen, with a CSS module each
  src/styles/       Design tokens and global rules
```

---

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

**Uploads.** Stored under a random filename that never derives from the upload,
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
- **`server/data/` holds the database and the uploaded originals** and is
  git-ignored. It is the only thing worth backing up, and nothing else in the
  repo is stateful.
- **There is no automated test suite yet.** Verification so far is a browser
  smoke run over every screen plus the join, upload, memory, editing and lens
  flows — including a pass under `prefers-reduced-motion` and one at 390px.
  Unit tests around `tree-layout.ts`, `placement.ts` and the permission checks
  would be the highest-value place to start.
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
