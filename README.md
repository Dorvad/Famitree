# שורשים — a living family archive

A Hebrew, right-to-left web application for keeping a family's tree, timeline
and heirlooms in one place. Built from a design prototype into a working
full-stack app: React on the front, an Express + SQLite API behind it.

Six screens — join, home, the tree, the timeline, the archive, and a person's
page — plus a search sheet and a three-step flow for adding a photograph,
letter, recording, object or story.

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
  smoke run over the six screens plus the join, upload and memory flows. Unit
  tests around `tree-layout.ts` and the permission checks would be the highest
  value place to start.
