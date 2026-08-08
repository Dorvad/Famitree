# שורשים — a living family archive

A Hebrew, right-to-left web application for keeping a family's tree, timeline
and heirlooms in one place. Built from a design prototype into a working
full-stack app: React on the front, an Express + SQLite API behind it.

Seven screens — join, home, the tree, the timeline, the archive, a person's
page, and an editing workshop where every record in the app can be created,
corrected or removed.

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
  src/components/   Shell, sheets, avatar, feedback states
  src/screens/      One file per screen, with a CSS module each
  src/styles/       Design tokens and global rules
```

---

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

Six signature animations are built on them:

| | |
| --- | --- |
| `unfold` | Cards hinge down from their top edge in perspective, like a letter opened flat. The house animation. |
| `develop` | Images wipe in over-exposed and washed out, then resolve to full contrast — a print coming up in the tray. |
| `slot` | Items push out from below already tilted, rotating to their resting angle. |
| `plant` | Tree nodes and portraits wind up, land, and wobble. |
| `ink` | Connectors draw with the nib widening as the line travels. |
| `stamp` | Confirmations land oversized and blurred, then thump down at an angle. |

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
Everything else here is long-standing CSS.

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
- **The hero headline is derived.** "מלודז׳ וברלין, עד אלינו" is built from the
  founding row's places, so it still tells the truth for a different family.
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
  smoke run over the seven screens plus the join, upload, memory and editing
  flows. Unit tests around `tree-layout.ts`, `placement.ts` and the permission
  checks would be the highest-value place to start.
- **Schema changes need a line in `ensureColumn`.** `CREATE TABLE IF NOT EXISTS`
  leaves an existing table alone, so a column added to `schema.sql` has no
  effect on a database that already holds records. `server/src/db/index.ts`
  applies missing columns idempotently at boot; add to it rather than assuming
  the schema file is enough.
