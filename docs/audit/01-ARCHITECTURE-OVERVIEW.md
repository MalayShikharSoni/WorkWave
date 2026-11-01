# 01 — Architecture Overview

> Ground-truth technical audit of the WorkWave EMS repository. This document describes
> the architecture **as it actually exists in code**, not as documentation claims.
> All file paths and line numbers refer to the committed state at the time of audit.

---

## 0. TL;DR — the single most important architectural fact

**There are THREE frontend applications committed to this repository**, and the README
only describes one of them:

| Directory | Stack | Status | Notes |
|-----------|-------|--------|-------|
| `frontend/` | React 18 + Vite + TypeScript | **The real, active app** | All features live here. Deployed to Vercel. |
| `frontend-next/` | Next.js 16 + React 19 | Abandoned/partial migration | Only Landing/Login/Signup/Dashboards partially ported. Missing most features. |
| `frontend-old/` | React + Tailwind (single file) | Dead code | Contains exactly ONE file: an old Tailwind-classed `EmployeeDashboard.tsx`. |

The git history confirms this is the residue of two abandoned migrations:

```
a553f01 initiation migration to Next.js + Typescript
b573d4d started migration from tailwind css to global/module css
066bd16 switch from tailwind css to module css
d9997a5 migrated react frontend to TypeScript
```

Unless stated otherwise, **"the frontend" in this audit means `frontend/`** (the Vite app),
because that is what `README.md` documents, what `vercel.json` deploys, and where every
feature actually exists.

---

## 1. Repository top-level structure

```
ems/
├── README.md                  # Root README — the closest thing to an SRS this repo has
├── .gitignore                 # Only ignores personal_notes/* (see §6 anomalies)
├── .vscode/settings.json
├── backend/                   # Express + TypeScript API server
├── frontend/                  # ACTIVE React (Vite) SPA
├── frontend-next/             # Abandoned Next.js migration
└── frontend-old/              # Dead single-file leftover
```

There is **no** `docs/` (before this audit), **no** `/SRS`, **no** planning documents,
**no** Dockerfile, **no** `.github/workflows`, and **no** CI configuration anywhere in the
repo. The only "specification" artifacts are three `README.md` files (root, `frontend/`,
`frontend-next/`), and two of those contradict each other.

---

## 2. Backend structure (`backend/`)

```
backend/
├── package.json               # Deps: express 5, pg, socket.io, jsonwebtoken, bcryptjs,
│                              #       cloudinary, multer, node-cron, helmet, cors,
│                              #       express-rate-limit, winston, streamifier
├── tsconfig.json              # CommonJS, target ES2020, strict: true
├── ts-err.txt                 # ⚠️ COMMITTED BUILD-ERROR DUMP (see §6)
├── .gitignore
└── src/
    ├── index.ts               # App entry: Express app, CORS, helmet, rate limit,
    │                          #   route mounting, Socket.io init, cron start
    ├── config/
    │   ├── database.ts         # pg Pool (single shared pool, max 20 connections)
    │   ├── cloudinary.ts       # Cloudinary SDK config from env
    │   └── migration.ts        # Ad-hoc migration script (run manually via node)
    ├── middleware/
    │   ├── auth.ts             # authenticate() + requireRole() JWT middleware
    │   └── errorHandler.ts     # Centralized error handler + AppError class (barely used)
    ├── routes/                 # Thin Express routers, one per domain
    │   ├── auth.ts             # /api/auth  (also inlines the /employees handler)
    │   ├── tasks.ts            # /api/tasks (tasks + attachments + comments)
    │   ├── invitations.ts      # /api/invitations
    │   ├── notifications.ts    # /api/notifications
    │   ├── employees.ts        # /api/employees/:id/stats
    │   ├── leaderboard.ts      # /api/leaderboard
    │   ├── groups.ts           # /api/groups (project groups feature)
    │   └── admin.ts            # /api/admin/analytics
    ├── controllers/            # Request handlers (business logic lives here AND in models)
    │   ├── authController.ts
    │   ├── taskController.ts
    │   ├── invitationController.ts
    │   ├── commentController.ts
    │   ├── notificationController.ts
    │   ├── employeeController.ts
    │   ├── leaderboardController.ts
    │   ├── groupController.ts
    │   └── analyticsController.ts
    ├── models/                 # Data-access classes wrapping raw SQL via pg
    │   ├── userModel.ts
    │   ├── taskModel.ts
    │   ├── attachmentModel.ts
    │   ├── commentModel.ts
    │   ├── notificationModel.ts
    │   ├── groupModel.ts
    │   └── leaderboardModel.ts
    ├── services/
    │   ├── socketService.ts    # Socket.io singleton (auth + emit helpers)
    │   └── githubService.ts    # GitHub REST API client with in-memory cache
    ├── cron/
    │   └── taskCron.ts         # node-cron: hourly overdue-task sweep
    └── types/
        ├── express.d.ts        # Augments Express.Request with `user`
        └── socketTypes.ts      # Socket event payload types
```

### 2.1 Directory purpose notes / inconsistencies

- **`controllers/` vs `models/` split is inconsistent.** Some controllers push SQL down into
  models (e.g. `taskController` → `taskModel`), while others run raw SQL directly against the
  `pool` inside the controller. `analyticsController.ts` (lines 16–128), `invitationController.ts`
  (all queries inline), and `auth.ts` route (lines 30–38) contain raw SQL with no model layer.
  So there is **no consistent data-access pattern** — it's roughly half ORM-ish models, half
  inline SQL.
- **`authController.getMe`** runs raw SQL (`authController.ts:138`) even though a `User` model
  exists and has a `findById` (`userModel.ts:50`). Duplicated concern.
- **The `/api/auth/employees` route** is not in a controller at all — the handler is written
  inline in the router file (`routes/auth.ts:27-51`), while every other auth handler is in
  `authController.ts`.
- **`errorHandler.ts` exports an `AppError` class** (`errorHandler.ts:10-20`) that is essentially
  unused — no controller throws `AppError`; every handler does its own `try/catch` +
  `res.status().json()`. The centralized error handler at `index.ts:80` almost never fires
  because errors are swallowed locally.

---

## 3. Frontend structure — active app (`frontend/`)

```
frontend/
├── index.html
├── package.json               # React 18, Vite 6, react-router-dom 7, axios,
│                              #   gsap, recharts, socket.io-client, react-toastify,
│                              #   @mui/*, @emotion/*  (⚠️ MUI/emotion unused — see doc 07)
├── vite.config.ts             # Bare: only @vitejs/plugin-react
├── postcss.config.js          # autoprefixer only
├── postcss.config.mjs         # ⚠️ references @tailwindcss/postcss (NOT installed) — see §6
├── vercel.json                # SPA rewrite: all routes -> /
├── tsconfig.json / tsconfig.node.json
├── test-notifications.cjs     # ⚠️ Manual script, NOT a test suite (see doc 08)
├── h --force origin main      # ⚠️ JUNK FILE — accidental git artifact (see §6)
└── src/
    ├── main.tsx                # Root render: <AuthProvider><SocketProvider><App/>
    ├── App.tsx                 # BrowserRouter + all <Route>s (NO route guards — see §5)
    ├── MainPage.tsx            # Redirect hub based on role
    ├── index.css / global.css  # Global styles (CSS, NOT Tailwind)
    ├── App.module.css / MainPage.module.css
    ├── context/
    │   ├── AuthProvider.tsx     # Auth state, login/register/logout, checkAuth
    │   └── SocketProvider.tsx   # Socket connection + toast + refreshTrigger
    ├── hooks/
    │   └── useNotifications.ts  # Notification fetch/optimistic-update hook
    ├── services/
    │   ├── api.ts              # Central Axios client + all typed API modules
    │   └── socket.ts           # socket.io-client wrapper
    ├── types/
    │   ├── index.ts            # Shared TypeScript types (mirror of backend shapes)
    │   └── svg.d.ts
    ├── components/
    │   ├── Auth/                # Login, Signup
    │   ├── Dashboard/           # AdminDashboard, EmployeeDashboard
    │   ├── TaskList/            # TaskList, New/Accepted/Completed/FailedTask,
    │   │                        #   TaskCommentsModal, TaskAttachments
    │   ├── Notifications/       # NotificationPanel
    │   ├── AvatarUpload/        # AvatarUpload
    │   ├── other/               # CreateTask, AllTasks, TeamManagement, Header,
    │   │                        #   NameForm, TaskListNumbers
    │   ├── CustomCursor.tsx     # GSAP custom cursor
    │   └── HoverEffect.tsx
    └── pages/
        ├── LandingPage.tsx
        ├── HeaderHomePage.tsx / HeaderUser.tsx / Footer.tsx
        ├── LoadingScreen.tsx / TVStaticEffect.tsx
        ├── ProfilePage.tsx / EmployeeProfilePage.tsx
        ├── LeaderboardPage.tsx
        ├── AnalyticsPage.tsx
        └── ProjectGroupsPage.tsx / GroupDetailPage.tsx
```

Note the somewhat arbitrary split between `components/` and `pages/`: `HeaderUser`, `Footer`,
`LandingPage` live under `pages/` but are components; `Dashboard` components live under
`components/`. There is no enforced convention.

---

## 4. Tech stack — declared vs. actually used

### Backend (from `backend/package.json`)

| Package | Declared | Actually used? | Evidence |
|---------|----------|----------------|----------|
| express `^5.2.1` | ✅ | ✅ | `index.ts` (Express **5** — note breaking changes vs 4) |
| pg `^8.18.0` | ✅ | ✅ | `config/database.ts` |
| jsonwebtoken | ✅ | ✅ | `authController.ts`, `middleware/auth.ts`, `socketService.ts` |
| bcryptjs | ✅ | ✅ | `userModel.ts` |
| socket.io | ✅ | ✅ | `services/socketService.ts` |
| cloudinary | ✅ | ✅ | `config/cloudinary.ts`, avatar + attachment upload |
| multer | ✅ | ✅ | `routes/auth.ts`, `routes/tasks.ts` |
| streamifier | ✅ | ✅ | `authController.ts`, `taskController.ts` |
| node-cron | ✅ | ✅ | `cron/taskCron.ts` |
| helmet | ✅ | ✅ | `index.ts:46` |
| cors | ✅ | ✅ | `index.ts:32` |
| express-rate-limit | ✅ | ✅ | `index.ts:50` |
| dotenv | ✅ | ✅ | multiple |
| ~~morgan~~ | — | 🗑️ Removed (Nov 2026) | Was unused |
| **winston** | ✅ | ❌ **UNUSED** | No import anywhere in `src/`; logging is raw `console.*` |

So the backend claimed structured logging (winston) and HTTP request logging (morgan, since removed) via
dependencies, but **all logging in practice is `console.log` / `console.error`** (see
`errorHandler.ts:29`, and dozens of `console.error` in controllers).

### Frontend (from `frontend/package.json`)

| Package | Declared | Actually used? | Evidence |
|---------|----------|----------------|----------|
| react / react-dom 18 | ✅ | ✅ | everywhere |
| react-router-dom 7 | ✅ | ✅ | `App.tsx` |
| axios | ✅ | ✅ | `services/api.ts` |
| gsap + @gsap/react | ✅ | ✅ | 18 files (animations, cursor) |
| recharts | ✅ | ✅ | `AnalyticsPage`, `GroupDetailPage`, `EmployeeProfilePage` (3 files) |
| socket.io-client | ✅ | ✅ | `services/socket.ts` |
| react-toastify | ✅ | ✅ | `SocketProvider.tsx` |
| **@mui/material** | ✅ | ❌ **UNUSED** | No import in `src/` |
| **@mui/icons-material** | ✅ | ❌ **UNUSED** | No import in `src/` |
| **@emotion/react** | ✅ | ❌ **UNUSED** | No import in `src/` (would only be needed by MUI) |
| **@emotion/styled** | ✅ | ❌ **UNUSED** | No import in `src/` |
| **path-browserify** | ✅ | ❌ **UNUSED** | No import in `src/` |

**Tailwind:** `README.md` claims "Tailwind CSS", and `postcss.config.mjs` references
`@tailwindcss/postcss`, but **`tailwindcss` is not a dependency** in `frontend/package.json`,
`index.css` contains **no `@tailwind` directives**, and styling is done entirely with **CSS
Modules + global CSS**. Tailwind was removed (git commit `066bd16 switch from tailwind css to
module css`) but the README and one PostCSS config were never updated. `frontend-old/` still
contains Tailwind utility classes but has no Tailwind toolchain to compile them.

---

## 5. Request lifecycle / data flow

### 5.1 Typical authenticated REST request (e.g. employee accepts a task)

```
[EmployeeDashboard.tsx / TaskList]
   └─ taskAPI.acceptTask(taskId)                       services/api.ts:110
        └─ axios PUT /api/tasks/:taskId/accept
             • request interceptor injects
               Authorization: Bearer <accessToken from localStorage>   api.ts:15-24
   ↓ HTTP
[Express server  index.ts]
   • cors()            index.ts:32
   • helmet()          index.ts:46
   • express.json()    index.ts:47
   • rateLimit()       index.ts:50   (100 req / 15 min / IP, GLOBAL)
   • router /api/tasks index.ts:58
        → router.use(authenticate)          routes/tasks.ts:16
            • verifies JWT with JWT_SECRET, sets req.user   middleware/auth.ts:19
        → TaskController.acceptTask          routes/tasks.ts:23
             • Task.getById()                taskModel.ts:114  → pool.query (raw SQL)
             • ownership check task.assigned_to === req.user.id
             • Task.updateStatus()           taskModel.ts:121
             • socketService.emitTaskStatusChanged(...)   taskController.ts:214
                  → io.to('user:<adminId>').emit('task:statusChanged', …)
                  → Notification.create(...) persisted + emitted 'notification:new'
             • res.json({ success, data })
   ↓ HTTP response {success, data|error}
[api.ts response interceptor]
   • on 401 (non-auth route): POST /api/auth/refresh with refreshToken,
     retry original request once.  api.ts:35-59
[SocketProvider] independently receives 'task:statusChanged' → toast + refreshTrigger++
[Dashboard useEffect on refreshTrigger] re-fetches tasks
```

### 5.2 Two parallel channels

Data reaches the UI through **two independent channels** that are only loosely reconciled:

1. **REST (pull):** components call `services/api.ts` methods on mount / on `refreshTrigger`.
2. **Socket.io (push):** `SocketProvider` listens for events and (a) shows a toast, (b) bumps a
   numeric `refreshTrigger` that dashboards depend on to re-fetch. `useNotifications` separately
   prepends `notification:new` payloads into local state.

The socket path rarely mutates component state directly; it mostly triggers a **full re-fetch**
via `refreshTrigger`. This is simple but means the socket payloads themselves are largely
discarded (e.g. the `task` object in `task:assigned` is used only for the toast title;
`SocketProvider.tsx:36-39`).

### 5.3 Auth/session flow (summary; full detail in doc 04)

- Access token (JWT, 15 min) + refresh token (JWT, 7 days) issued on login/register.
- Both stored in **`localStorage`** on the client (`AuthProvider.tsx:100-101`).
- Refresh tokens also persisted server-side in a `refresh_tokens` table.
- No httpOnly cookies are used anywhere.

---

## 6. Architectural anomalies, dead code, and committed junk

These are objective problems present in the committed tree:

1. **`backend/ts-err.txt`** — a committed file containing a captured PowerShell/ts-node
   **compilation error dump** (`TSError … Property 'user' does not exist on type 'Request'`).
   This is build output that was accidentally saved and committed. It is not referenced by
   anything.

2. **`frontend/h --force origin main`** — a committed **junk file** (git blob
   `57d4356…`) whose contents are captured `git log --graph` output. It was created by a
   mistyped git command (`git pus` `h --force origin main`) being redirected/captured into a
   file, then committed. Pure noise; should be deleted.

3. **`frontend/postcss.config.js` AND `frontend/postcss.config.mjs` both exist** with
   conflicting content: `.js` has only `autoprefixer`; `.mjs` references `@tailwindcss/postcss`
   (a package that is **not installed**). Having two PostCSS configs is ambiguous and one of
   them points at a missing dependency.

4. **Three frontends** (`frontend`, `frontend-next`, `frontend-old`) — two are abandoned. This
   roughly triples the surface area a reviewer must disambiguate and bloats the repo.

5. **Duplicate frontend files inside `frontend-next/`**: both `TeamManagement.jsx` and
   `TeamManagement.tsx` exist in `frontend-next/src/components/other/`.

6. **Root `.gitignore` only contains `personal_notes/*`** — it does not ignore `node_modules`,
   `.env`, `dist`, etc. (the per-package `.gitignore` files handle those). This is fragile; any
   stray file at the repo root would be committed by default.

7. **`AppError` class is dead** (`errorHandler.ts:10`) — defined and exported but never
   instantiated; the central error handler is effectively bypassed by per-handler try/catch.

8. **`leaderboardModel.getLiveLeaderboard` is dead & broken** (`leaderboardModel.ts:33-89`) — it
   contains invalid SQL (`Math.ROUND(...)`, which is not a Postgres function) and would throw at
   runtime. It was superseded by `getLiveLeaderboardSafe` (line 91), which the controller
   actually calls (`leaderboardController.ts:14`). The broken original was left in place, along
   with a block of stream-of-consciousness developer comments (lines 80–83).

See `08-KNOWN-GAPS-AND-TODOS.md` for the exhaustive list.

---

## 7. High-level architecture diagram (as-built)

```
                         ┌───────────────────────────────────────┐
   Browser (SPA)         │   frontend/  (Vite React 18, Vercel)   │
                         │   - Axios client (api.ts)  ── REST ──┐ │
                         │   - socket.io-client (socket.ts) ─┐  │ │
                         │   - localStorage: access+refresh   │  │ │
                         └────────────────────────────────────┼──┼─┘
                                                               │  │
                          Socket.io (JWT in handshake.auth)    │  │  HTTPS + Bearer JWT
                                                               ▼  ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │  backend/  Express 5 + Socket.io  (Render-targeted, single process)     │
   │  ┌─────────────┐   ┌───────────────┐   ┌───────────────┐               │
   │  │ REST routes │   │ socketService │   │ node-cron     │               │
   │  │ + controllers│  │ (singleton)   │   │ hourly overdue│               │
   │  └──────┬──────┘   └───────┬───────┘   └──────┬────────┘               │
   │         │  raw SQL / models │                  │                        │
   │         └────────────┬──────┴──────────────────┘                        │
   │                      ▼                                                   │
   │              pg Pool (max 20)                                            │
   └──────────────────────┬────────────────────────────────────────────────┘
                          ▼
              PostgreSQL (Neon-style, SSL rejectUnauthorized:false)

   External: Cloudinary (avatars + task attachments), GitHub REST API (group stats)
```

Everything runs in **one Node process** — REST, WebSocket server, and the cron scheduler share
the same event loop and the same `pg` pool. There is no queue, no worker, no cache layer other
than the in-memory `Map` in `githubService.ts`.
