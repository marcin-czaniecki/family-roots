# Rafałowscy — genealogy client

Private React app for the Rafałowscy family tree: interactive genealogy graph + admin dashboard for people and relations stored in Firebase Firestore.

## Stack

- **React 19** + **TypeScript** + **Vite**
- **React Router 8** (loaders, `createBrowserRouter`)
- **@xyflow/react** — canvas graph (nodes/edges)
- **Firebase Firestore** — data source
- **styled-components** — component styles (PersonNode, RelationNode, Dashboard)
- **Tailwind 4** — available via Vite plugin
- **Biome** — lint/format (`npm run lint` / `npm run format`)

Path alias: `@/` → `src/`.

## App routes

| Path | View | Role |
|------|------|------|
| `/` | `src/views/Home.tsx` | Genealogy tree (React Flow). Loader fetches `relations`, builds graph via `buildGenealogyGraph`. |
| `/dashboard` | `src/views/Dashboard.tsx` | CRUD UI for people & relations. Loader fetches `people` + `relations`. |

Layout/nav: `src/router.tsx`.

## Domain model (Firestore)

### Collection `people`

Normalized by `normalizePerson` in `src/entities/person/types.ts`.

Important fields: `firstName`, `lastName`, `birth` / `death` (`{ day, month, year } | null`), places, `photoUrl`, `sex` (boolean), `biography`, optional `father` / `mother` refs, `middleNames`.

Access helpers: `getPerson`, `getPeople`, `updatePerson`, `label` (display name).

### Collection `relations`

Two types (`src/entities/relation/types.ts`):

1. **`partner`** — marriage/union  
   - `first`, `second?` — person refs  
   - `root: boolean` — exactly one root partnership is the tree entry point  
   - `type: "partner"`

2. **`parent`** — child linked to parent(s) and/or a partnership  
   - `person` — child  
   - `first` / `second?` — parent person refs (optional)  
   - `parentship?` — ref to a `partner` relation (union that produced the child)  
   - `type: "parent"`

Helpers: `src/entities/relation/helpers.ts` — `childrenOf`, `partnersOf`, `sideOfKid`, `isPartner`, `isParent`.

## Genealogy layout (core logic)

**File:** `src/features/genealogyLayout.ts`  
**Entry:** `buildGenealogyGraph(relations)` → `{ nodes, edges }`.

### Node / edge types

- Nodes: `person` (`PersonNode`), `relation` (`RelationNode` — small union marker)
- Edges: `partner` (horizontal person↔union), `descent` (parent→child with `lane`: `union` | `direct`)

Constants: `PERSON_W`, `PERSON_H`, gaps, `TREE_GROWS_UP` from `src/features/genealogyDirection.ts` (currently `true` → children above parents).

### Layout rules (intended behavior)

1. Start from the `partner` relation with `root: true`.
2. Blood relative in a child’s own marriage stays on one card (no duplicate) when they have multiple partners.
3. **Multi-partner order for one person:**
   - 1st partnership → partner on the **right**
   - 2nd → partner on the **left**
   - then alternate
4. Handles on `PersonNode`: `partner-first` = right side, `partner-second` = left side.
5. Children of a partnership: `sideOfKid` → `left` | `center` | `union` | `right`  
   - union/`parentship` → center under the couple  
   - only left parent → left group  
   - only right parent → right group  
6. **Left-pair children should lay out to the left; right-pair children to the right** (and not share one centered trunk when they belong to different unions).
7. Width math must reserve space for person + partners + descendant subtrees so cards do not overlap siblings/partners/children (`personLayoutMetrics`, `kidsGroupStarts`, `partnershipBlockWidth`).

### Known pain points

- Overlaps between sibling cards, spouses, and children when subtree width / group starts are wrong.
- Descent edges for separate couples must not merge into one shared vertical trunk when kids belong to different partnerships.
- Spouse cards may get duplicate ids `personId~relationId` if the same person appears again as a non-shared spouse.

## Important directories

```
src/
  components/     # PersonNode, RelationNode, GenealogyEdges, FitToTop, PersonSearchSelect
  entities/       # person + relation domain (types, Firestore getters, helpers)
  features/       # genealogyLayout, genealogyDirection
  views/          # Home (tree), Dashboard (admin)
  firebase/       # db init
  router.tsx
```

## Conventions

- UI copy may be Polish; **code identifiers and commit messages in English**.
- Prefer matching existing patterns (styled-components in nodes/Dashboard, entity helpers over ad-hoc Firestore in views when possible).
- Do not commit secrets (Firebase config is in repo for this private app — still avoid adding new credentials).
- Deploy: Netlify (`netlify.toml`); SPA fallback expected.

## Commands

```sh
npm run dev       # Vite dev server
npm run build     # tsc -b && vite build
npm run lint      # biome check
npm run format    # biome check --write
```

## When changing the tree

1. Prefer fixing layout in `genealogyLayout.ts` + `entities/relation/helpers.ts`.
2. Keep width calculation and placement in sync (same metrics for slot size and `x` positions).
3. After layout changes, verify: multi-partner person (left/right), siblings with spouses, children of left vs right couple, no overlapping cards.
