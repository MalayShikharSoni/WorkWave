# 07 — Dependencies & Config

> Full audit of `package.json` files (backend + the three frontends), environment variables,
> and build/deploy configuration as it currently stands.

---

## 1. Backend dependencies (`backend/package.json`)

### 1.1 Runtime deps — usage audit

| Package | Version | Used? | Where / notes |
|---------|---------|-------|---------------|
| express | ^5.2.1 | ✅ | **Express 5** (not 4) — different middleware/error semantics; the codebase uses the classic `app.use(err handler)` which still works, but Express 5 is a deliberately notable choice. |
| pg | ^8.18.0 | ✅ | `config/database.ts` |
| jsonwebtoken | ^9.0.3 | ✅ | auth + sockets |
| bcryptjs | ^3.0.3 | ✅ | `userModel.ts` (bcryptjs 3.x) |
| socket.io | ^4.8.3 | ✅ | `socketService.ts` |
| cloudinary | ^2.10.0 | ✅ | avatars + attachments |
| multer | ^2.1.1 | ✅ | file uploads (multer **2.x**) |
| streamifier | ^0.1.1 | ✅ **(1 file group)** | only used to pipe buffers to Cloudinary in `authController.ts` + `taskController.ts` |
| node-cron | ^4.2.1 | ✅ **(1 file)** | only `cron/taskCron.ts` |
| helmet | ^8.1.0 | ✅ | `index.ts` |
| cors | ^2.8.6 | ✅ | `index.ts` |
| express-rate-limit | ^8.2.1 | ✅ **(1 file)** | only `index.ts` |
| dotenv | ^17.2.4 | ✅ | `dotenv.config()` called in 3 files |
| ~~morgan~~ | — | 🗑️ **Removed (Nov 2026)** | Was unused, and had a known vulnerability. `@types/morgan` removed too. |
| **winston** | ^3.19.0 | ❌ **UNUSED** | No import in `src/`. Logging is raw `console.*`. Dead dependency. |

**Unused/removable:** `winston` (`morgan` was removed in Nov 2026).
**Single-file deps** (fine, just noting): `node-cron`, `express-rate-limit`, `streamifier`.

### 1.2 Dev deps of note

| Package | Version | Note |
|---------|---------|------|
| typescript | ^5.9.3 | fine |
| @types/node | ^25.5.0 | very new major; ahead of most tooling |
| ts-node | ^10.9.2 | used by `dev` script |
| nodemon | ^3.1.14 | used by `dev` script |
| **@types/socket.io** | ^3.0.1 | ⚠️ **Deprecated & wrong** — `socket.io` v3+ ships its own types; the standalone `@types/socket.io` is a deprecated stub and should be removed. |
| @types/bcryptjs | ^2.4.6 | `bcryptjs` 3.x ships its own types; this `@types` package is redundant/mismatched (types for v2). |
| @types/express | ^5.0.6 | matches Express 5 |
| @types/node-cron, @types/multer, @types/pg, @types/cors, @types/jsonwebtoken, @types/streamifier | — | fine |

### 1.3 No test tooling

The backend has **no** `jest`, `vitest`, `mocha`, `supertest`, `ts-jest`, or any test runner in
`devDependencies`, and **no `test` script** (`scripts` are only `start`, `build`, `dev`). Zero
automated tests. See doc 08 §4.

---

## 2. Frontend (`frontend/package.json`) — active app

### 2.1 Runtime deps — usage audit

| Package | Version | Used? | Notes |
|---------|---------|-------|-------|
| react / react-dom | ^18.3.1 | ✅ | React 18 |
| react-router-dom | ^7.3.0 | ✅ | router v7 |
| axios | ^1.13.4 | ✅ | `services/api.ts` |
| gsap | ^3.12.7 | ✅ | 18 files |
| @gsap/react | ^2.1.2 | ✅ | `useGSAP` |
| recharts | ^3.8.1 | ✅ | 3 files (recharts **3.x**) |
| socket.io-client | ^4.8.3 | ✅ | `services/socket.ts` |
| react-toastify | ^11.0.3 | ✅ **(1 file)** | only `SocketProvider.tsx` |
| **@mui/material** | ^6.4.1 | ❌ **UNUSED** | no import in `src/` |
| **@mui/icons-material** | ^6.4.1 | ❌ **UNUSED** | no import in `src/` |
| **@emotion/react** | ^11.14.0 | ❌ **UNUSED** | (only a peer of MUI) |
| **@emotion/styled** | ^11.14.0 | ❌ **UNUSED** | (only a peer of MUI) |
| **path-browserify** | ^1.0.1 | ❌ **UNUSED** | no import in `src/` |

**Unused/removable:** `@mui/material`, `@mui/icons-material`, `@emotion/react`,
`@emotion/styled`, `path-browserify`. These pull a large amount of transitive weight (MUI +
Emotion) into the bundle graph for zero usage.

### 2.2 Dev deps of note

| Package | Version | Note |
|---------|---------|------|
| vite | ^6.0.5 | Vite 6 |
| @vitejs/plugin-react | ^4.3.4 | only Vite plugin configured |
| **typescript** | ^6.0.3 | ⚠️ TypeScript **6.x** in the frontend while the backend and frontend-next pin **5.x** — version skew across packages. |
| eslint 9 + typescript-eslint 8 + react plugins | — | ESLint configured (`eslint.config.js`), `lint` script present. |
| autoprefixer / postcss | — | see PostCSS config conflict below. |
| prettier | 3.5.3 | present; no format script wired. |

- **No `tailwindcss` dependency**, yet `postcss.config.mjs` references `@tailwindcss/postcss`
  (also not installed). See §5.
- **No test tooling** (no vitest/jest/RTL). Zero frontend tests.

---

## 3. `frontend-next/package.json` (abandoned) — brief

- next `16.2.1`, react/react-dom `19.2.4`, @mui `^7.3.9`, @emotion, axios, gsap, react-toastify.
- **No `recharts`, no `socket.io-client`** → cannot render the analytics/GitHub charts or do
  real-time. Confirms it's an incomplete port.
- `dev` script uses `next dev --webpack` (opting out of Turbopack).

## 4. `frontend-old/`

No `package.json` at all — it's a single stray `.tsx` file. Not a buildable project.

---

## 5. Configuration files

### 5.1 Backend `tsconfig.json`
- `module: commonjs`, `target: ES2020`, `strict: true`, `outDir: ./dist`, `declaration: true`,
  `sourceMap: true`, custom `typeRoots` including `./src/types`, and a `ts-node.files: true`
  block. Reasonable. The committed `ts-err.txt` shows a past `TS2339` where
  `req.user` wasn't recognized (the `types/express.d.ts` augmentation, now present, fixes it).

### 5.2 Frontend PostCSS — **conflicting dual config**
- `frontend/postcss.config.js`:
  ```js
  export default { plugins: { autoprefixer: {} } };
  ```
- `frontend/postcss.config.mjs`:
  ```js
  const config = { plugins: { "@tailwindcss/postcss": {} } };
  export default config;
  ```
Two PostCSS config files coexist. `.mjs` references `@tailwindcss/postcss`, which is **not in
`package.json`**. If PostCSS/Vite resolved the `.mjs`, the build would fail on the missing plugin;
the `.js` (autoprefixer-only) is the one that keeps builds working. This is leftover from the
Tailwind→CSS-modules migration (`git 066bd16`). One of these files should be deleted.

### 5.3 `vite.config.ts`
Minimal — just `@vitejs/plugin-react`. No path aliases, no proxy, no env plumbing.

### 5.4 `frontend/vercel.json`
- **Rewrite:** `/(.*)` → `/`. SPA fallback so client-side routes resolve to `index.html`.
- **Headers (added Nov 2026):** Content-Security-Policy, `X-Frame-Options`,
  `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` and HSTS on every route.
  See doc 04 §6a.
- The CSP's `connect-src` hard-codes the API origin (`https://workwave-d9ys.onrender.com` and
  its `wss://` form), so **changing the backend URL requires updating `vercel.json`**.

This is the **only** deployment config in the repo.

---

## 6. Environment variables — complete inventory

### Backend (read via `process.env.*`)

| Variable | Read in | Default / fallback | Required? |
|----------|---------|--------------------|-----------|
| `DATABASE_URL` | `config/database.ts:8` | none | **Yes** — no URL ⇒ pool can't connect |
| `JWT_SECRET` | `authController.ts` (sign/verify), `middleware/auth.ts:19`, `socketService.ts:51` | none | **Yes** — undefined ⇒ jwt throws at runtime |
| `JWT_REFRESH_SECRET` | `authController.ts:19,181` | none | **Yes** |
| `CLOUDINARY_CLOUD_NAME` | `config/cloudinary.ts:8` | none | Yes for uploads |
| `CLOUDINARY_API_KEY` | `config/cloudinary.ts:9` | none | Yes for uploads |
| `CLOUDINARY_API_SECRET` | `config/cloudinary.ts:10` | none | Yes for uploads |
| `GITHUB_PERSONAL_ACCESS_TOKEN` | `githubService.ts:81` | optional (unauthenticated GitHub calls if absent, subject to 60 req/hr rate limit) | No |
| `NODE_ENV` | `errorHandler.ts:55` | — (only used to decide whether to mask 500 messages) | No |
| `PORT` | `index.ts:82` | `5000` | No |

- ⚠️ **No `.env.example`** is committed for the backend, so a new dev must reverse-engineer the
  required variables. The README documents only `PORT`, `DATABASE_URL`, `JWT_SECRET`,
  `JWT_REFRESH_SECRET` — it **omits all Cloudinary vars and the GitHub token**, so following the
  README alone yields broken avatar/attachment uploads and GitHub stats.
- ⚠️ **No startup validation** of required vars (see doc 04 §10). Failures are lazy.

### Frontend (Vite)

| Variable | Read in | Default | Note |
|----------|---------|---------|------|
| `VITE_API_URL` | `services/api.ts:4`, `services/socket.ts:4` | `http://localhost:5000/api` | Used for **both** REST base and (incorrectly) the socket URL — see doc 04/05 for the `/api` bug. |

### frontend-next

| Variable | Read in | Default |
|----------|---------|---------|
| `NEXT_PUBLIC_API_URL` | `frontend-next/src/services/api.ts:3` | `http://localhost:5000/api` |

---

## 7. Build / deploy / hosting — as it stands

- **Frontend hosting:** Vercel (`vercel.json` in `frontend/`, live at
  `https://workwave-six.vercel.app` per README). Build = `vite build`, output SPA.
- **Backend hosting:** Render (inferred from `app.set('trust proxy', 1)` comment
  `index.ts:28-29` "required for Render", the api.ts comment about Render cold starts, and README
  "Render-ready"). No Render config file (`render.yaml`) is committed — deploy settings live in
  the Render dashboard, not the repo.
- **Backend build:** `tsc` → `dist/`, run `node dist/index.js`. Dev: `nodemon + ts-node`.
- **Database:** PostgreSQL, "Neon-ready" (SSL config). Not provisioned by any repo config.
- **Docker:** ❌ none (no Dockerfile / compose).
- **CI/CD:** ❌ none (no `.github/workflows`, no GitLab CI, no config). All deploys are
  platform-auto-deploy from git, with **no automated tests, lint gate, or build check** in CI.
- **Migrations in deploy:** `migration.ts` is a manual `node` invocation; it is **not** part of
  the build or start scripts, so schema changes are applied by hand. And as noted in doc 03, it
  can't bootstrap a fresh DB anyway.

---

## 8. Dependency-hygiene summary

| Issue | Detail |
|-------|--------|
| Unused backend deps | `winston` (`morgan` removed Nov 2026) |
| Unused frontend deps | `@mui/material`, `@mui/icons-material`, `@emotion/react`, `@emotion/styled`, `path-browserify` |
| Wrong/deprecated types | `@types/socket.io` (deprecated), `@types/bcryptjs` (v2 types for a v3 lib) |
| Version skew | TypeScript 6.x (frontend) vs 5.x (backend/next); React 18 vs 19 across the three frontends; @mui 6 vs 7 |
| Ghost config | `postcss.config.mjs` references uninstalled `@tailwindcss/postcss`; README claims Tailwind (removed) |
| Missing scaffolding | No `.env.example`, no CI, no Docker, no test tooling, no `render.yaml` |
| Committed junk | `backend/ts-err.txt`, `frontend/h --force origin main` (see doc 01 §6) |
