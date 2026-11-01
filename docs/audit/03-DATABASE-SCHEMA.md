# 03 — Database Schema

> PostgreSQL. Accessed exclusively through the `pg` driver via a single shared pool
> (`backend/src/config/database.ts`). There is **no ORM** and **no query builder** — every
> query is a hand-written SQL string.

---

## 0. Critical caveat: the schema is only partially defined in code

There is exactly one migration artifact: `backend/src/config/migration.ts`. It is **not** a
real migration framework — it is a single `migrate()` function full of
`CREATE TABLE IF NOT EXISTS` / `ALTER TABLE … ADD COLUMN IF NOT EXISTS` statements, run
manually via `node src/config/migration.js` (per README §4) and then `process.exit()`.

**`migration.ts` does NOT create three of the most important tables:** `users`, `tasks`, and
`refresh_tokens`. It only `ALTER`s `users` and `tasks` (assuming they already exist) and never
mentions `refresh_tokens` at all. The README (§4) even says: *"Ensure your database has these
tables: users, tasks, refresh_tokens, team_invitations"* and only provides a script for
`team_invitations`. So the canonical DDL for the core tables **does not exist anywhere in the
repo** — it must have been created by hand on the live database.

The reconstruction below marks each table as **[migration]** (fully defined in `migration.ts`)
or **[inferred]** (schema reverse-engineered from the SQL and TS interfaces that read/write it,
because no DDL is committed).

---

## 1. `users` — **[inferred]**

No `CREATE TABLE` in the repo. Reconstructed from `userModel.ts`, `migration.ts` (the ALTER on
lines 30-40), and every query that selects from it.

| Column | Type (inferred) | Nullable | Source of evidence |
|--------|-----------------|----------|--------------------|
| `id` | `SERIAL PRIMARY KEY` | no | referenced as FK everywhere |
| `email` | `VARCHAR` (unique) | no | `userModel.ts:34`, unique conflict handling |
| `password_hash` | `VARCHAR` | no | `userModel.ts:34`, bcrypt hash |
| `first_name` | `VARCHAR` | no | `userModel.ts:34` |
| `role` | `VARCHAR` (`'admin'`/`'employee'`) | no | `userModel.ts:34`; no DB-level CHECK constraint evident |
| `is_active` | `BOOLEAN` | no (default true) | `userModel.ts:45` `WHERE … is_active = true` |
| `created_at` | `TIMESTAMP` | no | `authController.ts:139` selects it |
| `last_login` | `TIMESTAMP` | yes | `userModel.ts:60-62` |
| `bio` | `TEXT` | yes | **added by** `migration.ts:33` |
| `phone` | `VARCHAR(20)` | yes | `migration.ts:34` |
| `designation` | `VARCHAR(100)` | yes | `migration.ts:35` |
| `department` | `VARCHAR(100)` | yes | `migration.ts:36` |
| `linkedin_url` | `VARCHAR(255)` | yes | `migration.ts:37` |
| `avatar_url` | `VARCHAR(255)` | yes | `migration.ts:38` |

TypeScript row shape: `UserRow` (`userModel.ts:12-27`).

**Notes / risks**
- Uniqueness of `email` is *assumed* (register relies on catching a duplicate via
  `findByEmail`, `authController.ts:35`, not on a DB unique constraint we can see). If no unique
  index exists, a race can create duplicate emails.
- `role` has no enforced enum at DB level; integrity depends on the app whitelisting it.
- No index on `email` is documented (login does `WHERE email = $1` on every auth) — **[inferred]
  none**, which would be a full scan at scale.

---

## 2. `tasks` — **[inferred]** (base) + **[migration]** (two columns)

No base `CREATE TABLE` committed. `migration.ts:23-27` only adds `priority` and `is_overdue`.
Reconstructed from `taskModel.ts` and all task SQL.

| Column | Type (inferred) | Nullable | Evidence |
|--------|-----------------|----------|----------|
| `id` | `SERIAL PRIMARY KEY` | no | FK target of attachments/comments |
| `title` | `VARCHAR` | no | `taskModel.ts:63` |
| `description` | `TEXT` | yes | `taskModel.ts:63` |
| `category` | `VARCHAR` | yes | `taskModel.ts:63` |
| `due_date` | `TIMESTAMP` | yes | `taskModel.ts:63` |
| `priority` | `VARCHAR(20)` default `'medium'` | no | **added** `migration.ts:25` |
| `is_overdue` | `BOOLEAN` default `false` | no | **added** `migration.ts:26` |
| `status` | `VARCHAR` (`new`/`active`/`completed`/`failed`) | no | `taskModel.ts:64` inserts `'new'` |
| `created_by` | `INTEGER` FK → `users(id)` | no | `taskModel.ts:63` |
| `assigned_to` | `INTEGER` FK → `users(id)` | no | `taskModel.ts:63` |
| `created_at` | `TIMESTAMP` | no | ordered by it everywhere |
| `updated_at` | `TIMESTAMP` | no | `taskModel.ts:126` sets `CURRENT_TIMESTAMP` |

TS row shape: `TaskRow` (`taskModel.ts:14-31`).

**Notes / risks**
- No DB-level CHECK on `status` or `priority`; `groupController`/`taskController` validate in JS
  (and `taskController` does *not* validate the status transition at all — see doc 02 §2).
- `updated_at` is bumped manually in `updateStatus` (`taskModel.ts:126`) — there is **no
  trigger**; any other update path (e.g. the overdue cron, `taskCron.ts:11`) does **not** touch
  `updated_at`. The overdue cron sets `is_overdue` without changing `updated_at`, which is
  actually relied upon by analytics (completions are dated by `updated_at`).
- No indexes on `assigned_to` / `created_by` / `status` are defined in the repo, yet these are
  the hot filter columns for `getByUserId`, `getAll`, analytics, and leaderboard — **[inferred]
  no supporting indexes**.

---

## 3. `refresh_tokens` — **[inferred]** (no DDL anywhere)

Never created or altered by `migration.ts`. Reconstructed from `authController.ts`.

| Column | Type (inferred) | Evidence |
|--------|-----------------|----------|
| `id` | `SERIAL PRIMARY KEY` (assumed) | — |
| `user_id` | `INTEGER` FK → `users(id)` | `authController.ts:52` |
| `token` | `TEXT`/`VARCHAR` (the full JWT) | `authController.ts:52,192,247` |
| `expires_at` | `TIMESTAMP` | `authController.ts:52` (`NOW() + INTERVAL '7 days'`) |

**Notes / risks**
- The **entire JWT refresh token is stored in plaintext** in this table (`authController.ts:52`).
  A DB read discloses usable refresh tokens. No hashing.
- Lookups do `WHERE token = $1 AND user_id = $2` (`authController.ts:192`) — needs an index on
  `token` to be efficient; none is defined in the repo.
- Expired rows are only removed on explicit logout; there is **no cleanup job** for expired
  refresh tokens, so the table grows unbounded (every login inserts a new row —
  `authController.ts:109`).

---

## 4. `team_invitations` — **[migration]** (`migration.ts:8-18`)

```sql
CREATE TABLE IF NOT EXISTS team_invitations (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES users(id),
  employee_id INTEGER NOT NULL REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  responded_at TIMESTAMP,
  UNIQUE(admin_id, employee_id)
);
```
- `UNIQUE(admin_id, employee_id)` prevents duplicate invites from the same admin.
- **No index** on `employee_id` alone, yet several queries filter/aggregate by `employee_id`
  (e.g. the single-team check in `sendInvitation`, leaderboard joins).
- The "one accepted team per employee" rule is enforced **only in application code**
  (`invitationController.ts:36-50, 160-175`), not by a DB constraint — a race between two
  admins' `respond` calls could put an employee on two teams.

---

## 5. `task_attachments` — **[migration]** (`migration.ts:43-57`)

```sql
CREATE TABLE IF NOT EXISTS task_attachments (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  file_url VARCHAR(500) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_type VARCHAR(100) NOT NULL,
  file_size INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_task_attachments_task_id ON task_attachments(task_id);
```
- ✅ Has `ON DELETE CASCADE` and an index on `task_id`. One of the better-defined tables.
- Deleting a task removes attachment rows, but **the Cloudinary blobs are never deleted** — no
  code calls Cloudinary destroy on task or attachment deletion (`taskController.deleteTask`,
  `deleteAttachment` only touch the DB). Orphaned files accumulate in Cloudinary.

---

## 6. `notifications` — **[migration]** (`migration.ts:61-79`)

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  entity_id VARCHAR(50),
  entity_type VARCHAR(50),
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(user_id, is_read);
```
- ✅ Indexed on `user_id` and `(user_id, is_read)` — appropriate for the unread-count and list
  queries (`notificationModel.ts`). Well done here.
- `entity_id` is `VARCHAR(50)` even though it always holds a numeric task/invitation id cast to
  string (`socketService.ts` passes `String(task.id)`). Minor type smell.

---

## 7. `task_comments` — **[migration]** (`migration.ts:83-94`)

```sql
CREATE TABLE IF NOT EXISTS task_comments (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);
```
- ✅ Cascade + index on `task_id`. Good.

---

## 8. `eom_records` (Employee of the Month) — **[migration]** (`migration.ts:98-108`)

```sql
CREATE TABLE IF NOT EXISTS eom_records (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES users(id),
  employee_id INTEGER NOT NULL REFERENCES users(id),
  month DATE NOT NULL,
  score INTEGER NOT NULL,
  snapshot_stats JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(admin_id, month)
);
```
- `snapshot_stats` (`JSONB`) stores the **client-supplied** leaderboard entry verbatim
  (`leaderboardModel.ts:154` — `JSON.stringify(snapshotStats)`), and `score` comes from that
  client payload. See doc 02 §6 and doc 04 for the trust issue.
- `UNIQUE(admin_id, month)` + `ON CONFLICT … DO UPDATE` (`leaderboardModel.ts:150`) means one
  winner per admin per month, re-crownable.
- **No index** on `employee_id`.

---

## 9. `project_groups` — **[migration]** (`migration.ts:113-123`)

```sql
CREATE TABLE IF NOT EXISTS project_groups (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  admin_id INTEGER NOT NULL REFERENCES users(id),
  github_repo_url VARCHAR(500),
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```
- No index on `admin_id` although `getGroupsByAdmin` filters on it.

---

## 10. `project_group_members` — **[migration]** (`migration.ts:128-140`)

```sql
CREATE TABLE IF NOT EXISTS project_group_members (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES project_groups(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES users(id),
  role_in_group VARCHAR(100),
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_pgm_group_id ON project_group_members(group_id);
```
- ✅ Cascade + unique + index on `group_id`. No index on `employee_id` (used by
  `getGroupsByEmployee` join).

---

## 11. `project_tasks` — **[migration]** (`migration.ts:144-164`)

```sql
CREATE TABLE IF NOT EXISTS project_tasks (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES project_groups(id) ON DELETE CASCADE,
  assigned_to INTEGER NOT NULL REFERENCES users(id),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  priority VARCHAR(20) DEFAULT 'medium',
  status VARCHAR(20) DEFAULT 'new',
  due_date TIMESTAMP,
  is_overdue BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_project_tasks_group_id ON project_tasks(group_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_assigned_to ON project_tasks(assigned_to);
```
- ✅ Best-indexed table. Note: `is_overdue` exists here but the **overdue cron
  (`taskCron.ts`) only updates the `tasks` table, not `project_tasks`** — so
  `project_tasks.is_overdue` is never set to true by anything. Dead column in practice.

---

## 12. Relationship map

```
users (1) ──< tasks.created_by
users (1) ──< tasks.assigned_to
users (1) ──< refresh_tokens.user_id
users (1) ──< team_invitations.admin_id
users (1) ──< team_invitations.employee_id
users (1) ──< notifications.user_id
users (1) ──< task_comments.author_id
users (1) ──< task_attachments.uploaded_by
users (1) ──< eom_records.admin_id / employee_id
users (1) ──< project_groups.admin_id
users (1) ──< project_group_members.employee_id
users (1) ──< project_tasks.assigned_to

tasks (1) ──< task_attachments.task_id   (ON DELETE CASCADE)
tasks (1) ──< task_comments.task_id       (ON DELETE CASCADE)

project_groups (1) ──< project_group_members.group_id (CASCADE)
project_groups (1) ──< project_tasks.group_id          (CASCADE)
```

Two parallel task systems exist: the primary personal `tasks` table and the separate
`project_tasks` table for the "project groups" feature. They share no rows and have divergent
lifecycles (only `tasks` is swept by the overdue cron; only `tasks` feeds the leaderboard and
analytics).

---

## 13. ORM vs raw SQL consistency

- **100% raw SQL** — no ORM. This is at least consistent in *tooling*.
- **Inconsistent in placement:** roughly half the SQL lives in `models/*` classes; the other
  half is inline inside controllers (`analyticsController`, `invitationController`,
  `authController.getMe`, the `/auth/employees` route). There is no single source of truth for
  the `users`/`tasks`/`refresh_tokens` shapes.
- **Transactions** are used in exactly one place — `GroupModel.create` (`groupModel.ts:67-96`,
  `BEGIN`/`COMMIT`/`ROLLBACK`). Everywhere else, multi-step operations (e.g. create task +
  insert N attachments, `taskController.ts:52-110`) run as **separate autocommitted queries with
  no transaction**, so a failure mid-way leaves partial state (task created, some attachments
  missing, socket event maybe already emitted).
- **Parameterization:** all queries use `$1,$2,…` placeholders — **no string interpolation of
  user input into SQL was found**, so first-order SQL injection risk is low. The one dynamic
  query (`userModel.updateProfile`, `userModel.ts:68-85`) builds the *column list* from a fixed
  whitelist and still parameterizes values — safe.

---

## 14. Migration history vs actual schema

- There is **no migration history table** and **no versioning** — `migration.ts` is idempotent
  (`IF NOT EXISTS`) and re-runnable, but there is no record of what has been applied.
- **The migration does not reproduce the full schema**: running it against an empty database
  would **fail** at the first `ALTER TABLE tasks …` (`migration.ts:24`) because `tasks` doesn't
  exist yet — and it never creates `users`, `tasks`, or `refresh_tokens`. So `migration.ts`
  cannot bootstrap a fresh environment; it assumes a pre-existing hand-made core schema.
- Therefore the committed migration **does not match** a from-scratch reproducible schema. A new
  engineer cannot stand up this DB from the repo alone.
