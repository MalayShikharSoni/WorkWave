# 02 — API Reference (as implemented)

> Every route mounted by `backend/src/index.ts`, documented from the actual router,
> controller, and middleware code. Where the README's API list disagrees with reality,
> the discrepancy is flagged.

Base URL: `/api` (mounted in `index.ts:57-64`). All JSON. Standard success envelope:
`{ "success": true, "data": ... }` (some also add `message`). Standard error envelope:
`{ "success": false, "error": "<message>" }` — **but this is not universal** (see §8).

Global middleware order (`index.ts`): `cors` → `helmet` → `express.json` → `rateLimit`
→ routers → `/api` 404 catch-all (`index.ts:72`) → `errorHandler` (`index.ts:80`).

Legend for **Validation** column:
- **None** = no checking of body/params beyond what SQL/JWT enforce
- **Partial** = presence checks only (e.g. `if (!x) 400`)
- **Type-coerce** = `parseInt`/`isNaN` guard on a param

---

## 1. Auth — `/api/auth` (`routes/auth.ts`)

| Method | Path | Middleware chain | Auth | Validation |
|--------|------|------------------|------|-----------|
| POST | `/api/auth/register` | — | Public | Partial |
| POST | `/api/auth/login` | — | Public | None |
| POST | `/api/auth/refresh` | — | Public (needs refresh token in body) | Partial |
| GET | `/api/auth/me` | `authenticate` | Any logged-in | n/a |
| POST | `/api/auth/logout` | `authenticate` | Any logged-in | None |
| PUT | `/api/auth/profile` | `authenticate` | Any logged-in | Types, lengths, LinkedIn URL |
| POST | `/api/auth/avatar` | `authenticate`, `multer.single('avatar')` | Any logged-in | Partial (file presence) |
| GET | `/api/auth/employees` | `authenticate`, `requireRole('admin')` | Admin | n/a |

### POST `/register` (`authController.ts:26`)
- Body: `{ email, password, firstName, role }`.
- `role` is whitelisted to `['admin','employee']`, defaults to `employee` (`authController.ts:31-32`).
- **No validation** of email format, password strength/length, or `firstName` presence. A
  registration with `password: undefined` would reach `bcrypt.hash(undefined, 10)`.
- Duplicate email → `400 {error:'Email already registered'}`.
- Response `201`: `{ user:{id,email,firstName,role}, accessToken, refreshToken }`.

### POST `/login` (`authController.ts:78`)
- Body: `{ email, password }`. **No presence validation** — a missing email calls
  `User.findByEmail(undefined)`.
- Wrong credentials → `401 {error:'Invalid credentials'}` (same message for unknown user and
  bad password — good practice).
- Response `200`: same shape as register.

### POST `/refresh` (`authController.ts:166`)
- Body: `{ refreshToken }`. Missing → `400`.
- Verifies JWT signature against `JWT_REFRESH_SECRET`, then looks the token up (stored as a
  SHA-256 hash) in `refresh_tokens`.
- *(Updated Nov 2026)* **Rotation + reuse detection:** every refresh issues a new refresh token
  and revokes the old one in a transaction. Presenting an already-revoked token revokes **all**
  of that user's sessions.
- Response `200`: `{ accessToken, refreshToken }`.

### GET `/me` (`authController.ts:136`)
- Returns the full user profile row (raw SQL, `authController.ts:138`).

### POST `/logout` (`authController.ts:240`)
- If `refreshToken` in body → deletes that one token row. If absent → deletes **all** the
  user's refresh tokens. Always `200`.

### PUT `/profile` (`authController.ts:271`)
- Body: any of `{ first_name, bio, phone, designation, department, linkedin_url }`.
- *(Updated Nov 2026)* Validated by `utils/profileValidation.ts` before the dynamic `UPDATE`:
  - every field must be a string;
  - values are trimmed and capped at the column sizes (`first_name` 100, `bio` 1000, `phone` 20,
    `designation`/`department` 100, `linkedin_url` 255);
  - `first_name` can't be blank.
- `linkedin_url` must be an `https://` URL on `linkedin.com` or a subdomain (an empty string
  clears it). This blocks `javascript:`/`data:` URLs, which the profile page renders as a link.
- Invalid input → `400` with a field-specific message.

### POST `/avatar` (`authController.ts:292`)
- Multipart, field `avatar`, 5 MB limit (`routes/auth.ts:8-11`).
- **No MIME-type validation** on avatars (unlike task attachments, which do validate). Any file
  ≤5 MB is streamed to Cloudinary `workwave/avatars`.
- ⚠️ **Bug:** the Cloudinary callback (`authController.ts:302-313`) only sends a response inside
  `if (result && result.secure_url)`. If Cloudinary returns no error but no `secure_url`, the
  request **hangs until the client/socket times out** — no response is ever sent.

### GET `/employees` (`routes/auth.ts:27` — inline handler, not in controller)
- Admin-only. Returns employees who **accepted this admin's** invitation. Own error handling
  (`try/catch` → 500) inline.

---

## 2. Tasks — `/api/tasks` (`routes/tasks.ts`)

`router.use(authenticate)` applies to **all** task routes (`routes/tasks.ts:16`).

| Method | Path | Extra middleware | Auth | Validation |
|--------|------|------------------|------|-----------|
| GET | `/my-tasks` | — | Any logged-in | n/a |
| GET | `/my-task-counts` | — | Any logged-in | n/a |
| PUT | `/:taskId/accept` | — | Any logged-in (ownership checked in handler) | None on `:taskId` |
| PUT | `/:taskId/complete` | — | Any logged-in (ownership checked) | None |
| PUT | `/:taskId/fail` | — | Any logged-in (ownership checked) | None |
| GET | `/:taskId/attachments` | — | Creator or assignee | None |
| POST | `/:taskId/attachments` | `requireRole('admin')`, `multer.array('files',5)` | Admin (creator) | Partial + MIME |
| DELETE | `/:taskId/attachments/:attachmentId` | `requireRole('admin')` | Task creator; attachment must belong to `:taskId` | Integer IDs |
| GET | `/:taskId/comments` | — | Task creator or assignee (`canAccessTask`) | n/a |
| POST | `/:taskId/comments` | — | Task creator or assignee (`canAccessTask`) | Partial (content) |
| DELETE | `/:taskId/comments/:commentId` | — | Comment author, and comment must belong to `:taskId` | None |
| POST | `/` | `requireRole('admin')`, `multer.array('files',5)` | Admin | Partial + MIME |
| GET | `/all` | `requireRole('admin')` | Admin (own tasks only) | n/a |
| GET | `/by-employee` | `requireRole('admin')` | Admin | n/a |
| DELETE | `/:taskId` | `requireRole('admin')` | Task creator | None |

### Notable behaviours / issues
- **Route ordering matters and is fragile.** `/:taskId/accept` etc. are declared before `/all`
  and `/by-employee`. Since `/all` and `/by-employee` are literal (not `:taskId`), they resolve
  fine, but the comment in the file (`routes/tasks.ts:27`) admits attachment routes were
  deliberately placed "before generic `/:taskId` routes" to avoid conflicts. This is manual,
  order-dependent routing.
- **`createTask` (`taskController.ts:22`)** validates only `title` and `assignedTo` presence.
  It **does** enforce that the assignee is on the admin's accepted team (`taskController.ts:37-49`)
  — good. Attachments validated for count (≤5) and MIME (`ALLOWED_FILE_TYPES`,
  `taskController.ts:10-17`).
- **`acceptTask`/`completeTask`/`failTask`** only check `task.assigned_to === userId`. There is
  **no state-machine validation** — an employee can `complete` a task that is still `new`
  (never accepted), or `fail` an already-`completed` task; the code blindly calls
  `updateStatus` (`taskController.ts:211/253/295`).
- *(Fixed)* **`deleteTask`** now checks `task.created_by` (previously any admin could delete any
  task). **`getAllTasks`** is now scoped to `created_by = adminId` (previously it returned every
  task in the database).
- *(Fixed Nov 2026)* **Comments** previously only restricted employees, so any admin could read
  or post on any task's thread. All three comment routes now use the shared
  `utils/authz.ts → canAccessTask` (creator or assignee only).
- *(Fixed Nov 2026)* **`deleteAttachment`** previously deleted by attachment ID with only a role
  check. It now loads the attachment, requires `attachment.task_id === :taskId`, and requires
  the requester to be the task's creator. Cloudinary files are still not removed on delete.

---

## 3. Invitations — `/api/invitations` (`routes/invitations.ts`)

`router.use(authenticate)` on all.

| Method | Path | Middleware | Auth | Validation |
|--------|------|-----------|------|-----------|
| POST | `/send` | `requireRole('admin')`, invite limiter (20/hour per admin) | Admin | Email format |
| GET | `/team` | `requireRole('admin')` | Admin | n/a |
| GET | `/pending` | `requireRole('admin')` | Admin | n/a |
| GET | `/my-invitations` | — | Any logged-in | n/a |
| PUT | `/respond/:id` | — | Any logged-in (scoped to their own invite) | Partial |

*(Changed Nov 2026)* `GET /available-employees` was **removed**. It returned the name and email
of every unassigned employee to any admin, and anyone can register as an admin, so it was a
global user directory.

- **`sendInvitation`** takes `{ email }`, not `{ employeeId }`:
  - The email is trimmed, lower-cased and matched case-insensitively against active employees;
    there is no ID-based lookup.
  - Errors don't name other admins: the response is "already on another team", not
    "already on X's team".
  - Re-inviting someone who rejected you is blocked for **7 days** after their response
    (`429`).
  - The route has a per-admin rate limiter of 20 attempts per hour, keyed by user ID. It's held
    in memory, so it resets on restart.
- `:id` in `respond` is used as a parameterized value, scoped by `employee_id = req.user.id`.
- **`respondToInvitation` (`invitationController.ts:122`)** validates `status ∈
  {accepted,rejected}` and re-checks single-team constraint. Good.

---

## 4. Notifications — `/api/notifications` (`routes/notifications.ts`)

`router.use(authenticate)` on all.

| Method | Path | Auth | Validation |
|--------|------|------|-----------|
| GET | `/` | Any logged-in | Type-coerce (`limit`,`offset` via `parseInt` w/ defaults) |
| GET | `/unread-count` | Any logged-in | n/a |
| PUT | `/read-all` | Any logged-in | n/a |
| PUT | `/:id/read` | Any logged-in (scoped by user_id in SQL) | Type-coerce |

- `getNotifications` supports pagination via `?limit=&offset=` (default 20/0,
  `notificationController.ts:9-10`). `markAsRead` scopes by `user_id` so a user cannot mark
  another user's notification (`notificationModel.ts:53-57`). This is the **only** paginated
  list endpoint in the API.

---

## 5. Employees — `/api/employees` (`routes/employees.ts`)

| Method | Path | Middleware | Auth | Validation |
|--------|------|-----------|------|-----------|
| GET | `/:employeeId/stats` | `authenticate` | Admin (any) or the employee themselves | Type-coerce |

- `employeeController.ts:12-21`: `isNaN` guard on id; employees may only view their own stats,
  admins may view **anyone's** (no team-scoping — an admin can read stats for an employee on a
  *different* admin's team).

---

## 6. Leaderboard — `/api/leaderboard` (`routes/leaderboard.ts`)

| Method | Path | Middleware | Auth | Validation |
|--------|------|-----------|------|-----------|
| GET | `/` | `authenticate` | Admin (checked in controller) | n/a |
| GET | `/history` | `authenticate` | Admin (checked in controller) | n/a |
| POST | `/archive` | `authenticate` | Admin (checked in controller) | Partial |

- Role check is done **inside the controller** (`leaderboardController.ts:8`), not via
  `requireRole` middleware — an inconsistency with tasks/invitations which use middleware.
- *(Fixed)* `POST /archive` body: `{ employeeId }` only. The score and stats snapshot are
  recomputed server-side from the live leaderboard query. Previously a client-supplied score
  was stored verbatim.

---

## 7. Groups — `/api/groups` (`routes/groups.ts`)

`router.use(authenticate)` on all. Role/ownership enforced **inside controller methods**.

| Method | Path | Auth (as enforced) | Validation |
|--------|------|--------------------|-----------|
| POST | `/` | Admin (checked in handler) | Partial |
| GET | `/` | Any logged-in (branches admin/employee) | n/a |
| GET | `/my-tasks` | Any logged-in | n/a |
| GET | `/:groupId` | Admin-owner OR group member | Type-coerce |
| POST | `/:groupId/tasks` | Admin-owner | Partial |
| GET | `/:groupId/tasks` | Admin-owner OR group member | Type-coerce |
| GET | `/:groupId/progress` | Admin-owner OR group member | Type-coerce |
| PUT | `/:groupId/github` | Admin-owner | None |
| GET | `/:groupId/github-stats` | Admin-owner OR group member | Type-coerce |
| PUT | `/:groupId/tasks/:taskId/status` | Group admin-owner or the task's assignee; task must belong to `:groupId` | Partial |

### Group authorization
- *(Fixed)* `getGroupTasks`, `getGroupProgress`, `getGithubStats` and `updateTaskStatus`
  previously had no access check. They now go through `checkGroupAccess`.
- ⚠️ Still open: `createGroup` does **not** verify that `memberIds` are on the admin's team, so
  an admin can add arbitrary user IDs as group members.

---

## 8. Admin analytics — `/api/admin` (`routes/admin.ts`)

| Method | Path | Middleware | Auth | Validation |
|--------|------|-----------|------|-----------|
| GET | `/api/admin/analytics` | `authenticate` | Admin (checked in controller) | n/a |

- `analyticsController.getAnalytics` (`analyticsController.ts:6`) runs **7 separate sequential
  SQL queries** per request (team count, tasks-this-month, overall stats, by-priority,
  most-active, daily completions via `generate_series`, per-employee, avg time). All scoped to
  `created_by = adminId`. No caching. See `08-KNOWN-GAPS-AND-TODOS.md` for the perf note.

---

## 9. Error-response format consistency

The **intended** contract is `{ success:false, error:"..." }`, and most handlers follow it.
Concrete inconsistencies:

1. **Success responses are inconsistent.** Some return `{success,data}`, some add `message`
   (`invitationController.ts:110`, `taskController.ts:349`, `groupController.ts:29`), some
   return `{success, data:{count}}` (`notificationController.ts:33`), some
   `{success, data:{markedCount}}` (`:78`). Field names vary (`markedCount` vs `count`).
2. **404 for unknown API routes** comes from a catch-all (`index.ts:72`) with
   `error: 'Route METHOD URL not found'` — a different phrasing style than handler errors.
3. **The central `errorHandler`** (`errorHandler.ts`) maps `ValidationError`,
   `JsonWebTokenError`, PG codes `23505`/`23503`, etc. — but because virtually every controller
   swallows its own errors with a local `try/catch` returning a generic 500 message
   ("Failed to fetch tasks", "Login failed", …), **the rich error mapping almost never runs**.
   PG constraint violations that *would* map to 409/400 instead surface as generic 500s.
4. **Validation errors are ad-hoc 400s** written per-handler; there is no shared validator, no
   Joi/Zod/express-validator. Message wording is inconsistent
   (`'Missing employeeId'` vs `'Title and assignedTo are required'` vs `'Invalid status'`).
5. **Auth failures**: `middleware/auth.ts` returns `{success:false,error:'No token provided'}`
   or `'Invalid or expired token'`; but `middleware/auth.ts:32` (`requireRole`) accesses
   `req.user.role` — if `authenticate` did not run first (it always does in current wiring)
   this would throw. If a malformed `Authorization` header has no second segment,
   `authHeader.split(' ')[1]` is `undefined` and `jwt.verify(undefined,…)` throws → caught →
   401 (acceptable, but relies on the catch).

---

## 10. Discrepancies vs README's advertised API

*(Resolved)* At the time of the audit the root `README.md` documented only about a third of the
API. The README has since been rewritten: its "API at a glance" table covers every module, and
this document is the route-by-route reference.
