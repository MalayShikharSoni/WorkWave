# 00 — Audit Status

The documents in this folder are a code audit written in **July 2026**. They describe the code
as it was then. This page tracks what has changed since, so the audit can be read without
mistaking fixed issues for open ones.

**Last updated:** 1 Nov 2026

## Fixed since the audit

| Area | Change | Where it's documented |
|---|---|---|
| Authorization | `deleteTask` checks ownership; `getAllTasks` scoped to the admin; group endpoints use `checkGroupAccess` | 02 §2, §7 · 04 §13 |
| Authorization | Comment routes restricted to the task's creator and assignee (`utils/authz.ts`) | 02 §2 · 04 §13 (S15) |
| Authorization | Attachment delete requires task ownership and a matching task ID | 02 §2 · 04 §13 (S16) |
| Privacy | `GET /invitations/available-employees` removed; invitations sent by exact email, 20/hour per admin, 7-day cooldown after a rejection | 02 §3 · 04 §13 (S17) |
| Input validation | `PUT /auth/profile` validates types and lengths; `linkedin_url` must be an https LinkedIn URL | 02 §1 · 04 §13 (S18) |
| Tokens | Refresh tokens hashed, rotated on use, with reuse detection; single-flight refresh on the client | 02 §1 · 04 §5, §13 |
| Brute force | Separate login and register limiters (5 failures / 15 min) | 04 §13 (S7) |
| Real-time | Socket.IO URL no longer includes `/api`; sockets disconnect at token expiry and reconnect with a refreshed token | 04 §13 (S8) |
| Database | TLS certificate verification for non-local databases; migration creates `refresh_tokens` | 04 §13 (S9) |
| Leaderboard | Employee-of-the-Month score recomputed server-side | 02 §6 |
| Frontend | Security headers and CSP in `vercel.json`; auth debug logging removed | 04 §6a |
| Dependencies | `npm audit fix` in both packages (0 production vulnerabilities); unused `morgan` removed | 07 |
| Repo | Abandoned `frontend-next/` and `frontend-old/` deleted | — |

## Still open (highlights)

- Tokens still live in `localStorage`; moving the refresh token to an httpOnly cookie needs the
  frontend and API on the same site.
- No task status state machine; no validation on registration.
- An admin can view any employee's stats and add any user to a group.
- No automated tests or CI; ESLint config doesn't match `.ts`/`.tsx` files.
- The migration can't create `users`/`tasks` on an empty database.
- See `08-KNOWN-GAPS-AND-TODOS.md` for the full list as of the audit.

## Operational notes

- After deploying the Nov 2026 changes, run `npx ts-node src/config/migration.ts` once against
  production. It clears any stored `linkedin_url` that isn't an https LinkedIn URL. It's safe to
  re-run.
- The frontend CSP hard-codes the API origin. If the backend URL changes, update `connect-src`
  in `frontend/vercel.json`.
- Line numbers quoted in docs 01–08 refer to the July code and may have drifted.
