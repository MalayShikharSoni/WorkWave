# 04 — Auth & Security

> The full JWT dual-token flow, session handling, CORS, rate limiting, socket auth, and a
> blunt security assessment. Actual code is pasted, not paraphrased.

---

## 1. Token generation (access + refresh)

`backend/src/controllers/authController.ts:10-24`:

```ts
static generateTokens(user: { id: number; email: string; role: string }) {
  const accessToken = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET as string,
    { expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    { id: user.id },
    process.env.JWT_REFRESH_SECRET as string,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken };
}
```

- Access token: 15 min, carries `{id, email, role}`.
- Refresh token: 7 days, carries only `{id}`.
- Two **separate** secrets (`JWT_SECRET`, `JWT_REFRESH_SECRET`). If either env var is undefined,
  `jwt.sign(..., undefined)` **throws at runtime** — there is no startup check that these exist
  (they're cast with `as string` which only silences TypeScript, `authController.ts:13`).

On both **register** (`authController.ts:51-54`) and **login** (`authController.ts:109-112`) the
refresh token is persisted:

```ts
await pool.query(
  'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'7 days\')',
  [user.id, refreshToken]
);
```

Every login/register inserts a **new** row — old rows are never pruned except on logout, so the
table grows unbounded.

---

## 2. Refresh flow (rotation? revocation?)

`authController.ts:166-238`:

```ts
static async refresh(req: Request, res: Response): Promise<void> {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) { /* 400 */ }

    let decoded: { id: number };
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET as string) as { id: number };
    } catch { /* 401 Invalid or expired refresh token */ }

    // Check the token exists in DB and hasn't been revoked
    const tokenResult = await pool.query(
      'SELECT * FROM refresh_tokens WHERE token = $1 AND user_id = $2 AND expires_at > NOW()',
      [refreshToken, decoded.id]
    );
    if (tokenResult.rows.length === 0) { /* 401 not found or expired */ }

    const userResult = await pool.query('SELECT id, email, role FROM users WHERE id = $1', [decoded.id]);
    if (userResult.rows.length === 0) { /* 401 User not found */ }

    const user = userResult.rows[0];
    const accessToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET as string,
      { expiresIn: '15m' }
    );

    res.json({ success: true, data: { accessToken } });
  } catch (error) { /* 500 */ }
}
```

**Assessment:**
- ✅ Server-side validation against the `refresh_tokens` table means a refresh token *can* be
  revoked (by deleting its row). This is better than stateless-only refresh.
- ❌ **No refresh-token rotation.** The same refresh token is reused for its full 7-day life; a
  new access token is minted but the refresh token is not replaced. A stolen refresh token is
  valid for up to 7 days regardless of use.
- ❌ **No reuse detection / token family tracking** — a classic rotation-based theft-detection
  scheme is absent.
- ✅ The new access token re-reads `role` from the DB (`authController.ts:205-222`), so a role
  change would propagate on next refresh (within ≤15 min).

---

## 3. Logout / revocation

`authController.ts:240-269`:

```ts
static async logout(req: Request, res: Response): Promise<void> {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await pool.query('DELETE FROM refresh_tokens WHERE token = $1 AND user_id = $2',
        [refreshToken, req.user.id]);
    } else {
      // If no token provided, revoke ALL refresh tokens for this user
      await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [req.user.id]);
    }
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) { /* 500 */ }
}
```

- ✅ Refresh tokens are revocable and logout removes them.
- ❌ **Access tokens cannot be revoked.** They are stateless and valid until their 15-min expiry
  regardless of logout. There is no denylist. So "logout" does not immediately invalidate an
  already-issued access token.

---

## 4. Access-token verification middleware

`backend/src/middleware/auth.ts` (full file):

```ts
const authenticate = (req, res, next): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader) { res.status(401).json({ success:false, error:'No token provided' }); return; }

  const token = authHeader.split(' ')[1]; // "Bearer <token>"

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string);
    req.user = decoded as Request['user'];
    next();
  } catch {
    res.status(401).json({ success:false, error:'Invalid or expired token' });
  }
};

const requireRole = (role: string) => {
  return (req, res, next): void => {
    if (req.user.role !== role) {
      res.status(403).json({ success:false, error:'Insufficient permissions' });
      return;
    }
    next();
  };
};
```

- If `Authorization` has no second token part, `token` is `undefined`; `jwt.verify(undefined,…)`
  throws → caught → 401. OK, but relies on the catch.
- `requireRole` reads `req.user.role` and assumes `authenticate` already ran. In current wiring
  it always does. If ever mounted alone, it would throw on `req.user` undefined.
- **Role model is binary** (`admin` / `employee`) with no granularity. Many endpoints do the
  role check *inside the controller* rather than via `requireRole` (leaderboard, groups,
  analytics), which is inconsistent and easier to get wrong (and indeed several group endpoints
  have no check at all — see doc 02 §7).

---

## 5. Client-side token storage & auto-refresh

Tokens are stored in **`localStorage`** (`frontend/src/context/AuthProvider.tsx:100-101`,
`126-127`):

```ts
localStorage.setItem('accessToken', accessToken);
localStorage.setItem('refreshToken', refreshToken);
```

The Axios client attaches the access token and transparently refreshes on 401
(`frontend/src/services/api.ts:15-63`):

```ts
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use((r) => r, async (error) => {
  const originalRequest = error.config;
  const isAuthRoute = originalRequest.url?.includes('/auth/login') || originalRequest.url?.includes('/auth/register');
  if (error.response?.status === 401 && !originalRequest._retry && !isAuthRoute) {
    originalRequest._retry = true;
    try {
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) { localStorage.clear(); window.location.href = '/login'; return Promise.reject(error); }
      const response = await axios.post(`${API_URL}/auth/refresh`, { refreshToken });
      const { accessToken } = response.data.data;
      localStorage.setItem('accessToken', accessToken);
      originalRequest.headers.Authorization = `Bearer ${accessToken}`;
      return api(originalRequest);
    } catch (refreshError) { localStorage.clear(); window.location.href='/login'; return Promise.reject(refreshError); }
  }
  return Promise.reject(error);
});
```

**Assessment:**
- ❌ **`localStorage` tokens are readable by any JavaScript on the page → XSS = full token
  theft** (both access and refresh). No httpOnly cookie option is used anywhere. This is still
  the biggest client-side auth risk.
  - *(Nov 2026)* Partly mitigated by the strict `script-src 'self'` CSP (§6a).
  - Planned fix: move the refresh token to an `httpOnly; Secure` cookie. That needs the
    frontend and API on the same site (a custom domain, or proxying `/api` through Vercel),
    because browsers block cookies set by a different site.
- *(Fixed)* Refresh is now **single-flight** (`services/tokenRefresh.ts`), shared by the Axios
  interceptor and the socket client. This matters because refresh tokens now rotate.
- *(Fixed Nov 2026)* `AuthProvider` no longer logs token previews or user details to the
  console.
- ⚠️ Refresh failures hard-redirect via `window.location.href = '/login'` (full page reload),
  bypassing the router.

---

## 6. Session / cookie handling

- **No cookies are used at all.** No `cookie-parser`, no `Set-Cookie`, no CSRF tokens. All auth
  is Bearer-header + localStorage. (This sidesteps CSRF but maximizes XSS exposure.)
- No server-side session store beyond the `refresh_tokens` table.

---

## 6a. Frontend security headers *(added Nov 2026)*

`frontend/vercel.json` sends these headers on every route:

| Header | Value / purpose |
|---|---|
| `Content-Security-Policy` | `script-src 'self'` (no inline or third-party scripts); `connect-src` limited to `'self'` and the API origin `https://workwave-d9ys.onrender.com` (plus `wss://` for Socket.IO); images from `'self'`, `data:`, Cloudinary and GitHub avatars; fonts from Google Fonts; `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `upgrade-insecure-requests` |
| `X-Frame-Options` | `DENY` (clickjacking, for older browsers) |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | camera, microphone, geolocation and payment disabled |
| `Strict-Transport-Security` | 2 years, include subdomains |

Notes:
- **If the API URL changes, update `connect-src` in `vercel.json`**, or the browser will block
  every API and socket call.
- `style-src` allows `'unsafe-inline'`, because react-toastify v11 injects its stylesheet as a
  `<style>` tag at runtime. Inline styles can't run script, so the main XSS protection
  (`script-src 'self'`) is unaffected.
- The policy was checked in headless Chrome against a production build served with these exact
  headers: no violations on `/`, `/login`, `/signup` or `/admin-dashboard`.
- Profile links are also defended directly: the API only accepts `https://` LinkedIn URLs, and
  `EmployeeProfilePage` only renders an `href` that passes `utils/safeUrl.ts`.

---

## 7. CORS

`backend/src/index.ts:32-43`:

```ts
app.use(cors({
  origin: [
    'http://localhost:3000','http://localhost:3001',
    'http://localhost:5173','http://localhost:5174',
    'https://workwave-six.vercel.app'
  ],
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));
```

- Allow-list is **hardcoded** (no env-driven config). Adding a new frontend origin requires a
  code change + redeploy.
- `credentials: true` is set even though credentials are never cookies here (harmless but
  misleading).
- The same hardcoded origin list is **duplicated** in `socketService.ts:31-37` — two sources of
  truth to keep in sync.

`helmet()` is enabled with defaults (`index.ts:46`), placed **after** CORS (the code comment at
`index.ts:31` explains this is intentional for preflight).

---

## 8. Rate limiting

`backend/src/index.ts:50-54`:

```ts
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100                  // limit each IP to 100 requests per windowMs
});
app.use(limiter);
```

- **One global limiter**, 100 requests / 15 min / IP, applied to **every** route including
  `GET`s. `app.set('trust proxy', 1)` (`index.ts:29`) makes it use the proxy's forwarded IP
  (correct for Render).
- ❌ **No stricter limit on auth endpoints.** `/auth/login` and `/auth/register` share the same
  generic 100/15min budget — there is no dedicated brute-force protection on login. 100
  password guesses per 15 min per IP is quite permissive for a login endpoint.
- ⚠️ 100 req/15min is also **very low for normal app usage** — dashboards fire several requests
  per view and the analytics page alone triggers multiple calls; an active user could hit the
  limit and get throttled on legitimate traffic. In-memory store means limits reset on every
  deploy/restart and are not shared across instances.

---

## 9. Socket.io authentication

`backend/src/services/socketService.ts:43-58`:

```ts
this.io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error: No token provided'));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id: number; role: string };
    socket.data.userId = decoded.id;
    socket.data.role = decoded.role;
    next();
  } catch (err) {
    next(new Error('Authentication error: Invalid token'));
  }
});
```

Client sends the token in the handshake (`frontend/src/services/socket.ts:13-16`):

```ts
socket = io(SOCKET_URL, { auth: { token }, reconnection: true, reconnectionAttempts: Infinity, ... });
```

On connect (`socketService.ts:60-77`), the socket auto-joins a personal room `user:<id>` and,
if admin, `admin:<id>`.

**Assessment:**
- ✅ Sockets require a valid **access** JWT; rooms are keyed by the authenticated user id, so a
  client cannot trivially receive another user's events.
- ❌ **The socket JWT is verified once at connect and never re-checked.** A connection with
  `reconnectionAttempts: Infinity` can persist far beyond the 15-min access-token expiry — the
  handshake token isn't re-validated on the live connection, so a revoked/expired token keeps
  receiving events until the socket physically disconnects.
- ⚠️ **`SOCKET_URL` bug** (`frontend/src/services/socket.ts:4`):
  `const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000'`. But
  `VITE_API_URL` is set to the REST base **including `/api`** (README: `http://localhost:5000/api`).
  So the socket client connects to `http://localhost:5000/api` as its origin, which is not where
  the Socket.io server is mounted (it's on the bare server root). In local dev with the default
  fallback this happens to work, but with `VITE_API_URL` set (i.e. production) the socket
  endpoint is wrong. This is a latent real-time-in-prod bug.

---

## 10. Secrets, keys, credentials

- ✅ **No secrets are hardcoded or committed.** All sensitive config is read from env:
  `JWT_SECRET`, `JWT_REFRESH_SECRET` (`authController.ts`, `auth.ts`, `socketService.ts`),
  `DATABASE_URL` (`config/database.ts:8`), `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET`
  (`config/cloudinary.ts:8-10`), `GITHUB_PERSONAL_ACCESS_TOKEN` (`githubService.ts:81`).
- ✅ No `.env` file is tracked by git (verified via `git ls-files`). `.env*` is ignored in
  `backend/.gitignore`.
- ⚠️ The only literal credentials in the repo are throwaway test values in
  `frontend/test-notifications.cjs` (`password: 'password123'`, `authController` not affected).
  Not a real secret, but it is committed test scaffolding.
- ⚠️ **No startup validation** that required secrets are present — a missing `JWT_SECRET` fails
  lazily at first sign/verify instead of refusing to boot.

---

## 11. Database connection security

`backend/src/config/database.ts:7-13`:

```ts
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000,
});
```

- ⚠️ **`ssl: { rejectUnauthorized: false }`** disables TLS certificate verification on the DB
  connection. It encrypts traffic but does **not** verify the server's certificate → susceptible
  to MITM on the DB link. Common for Neon/Render convenience, but it is a real weakening of
  transport security and should ideally pin the CA.

---

## 12. Password handling

`backend/src/models/userModel.ts:31,56-58`:

```ts
const hashedPassword = await bcrypt.hash(password, 10);   // create
return await bcrypt.compare(plainPassword, hashedPassword); // verify
```

- ✅ `bcryptjs` with cost factor 10. Reasonable.
- ❌ **No password policy** — length, complexity, and even *presence* are unchecked at register
  (`authController.register` does not validate `password`), so empty or 1-char passwords are
  accepted and hashed.

---

## 13. Consolidated security findings (blunt)

Status as of **1 Nov 2026**. Original line numbers have been dropped because the code has moved
since the audit.

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| S1 | **High** | Broken authorization / IDOR: `deleteTask` didn't check task ownership; admins could delete any task. | ✅ Fixed |
| S2 | **High** | Broken authorization / IDOR in groups: `getGroupTasks`, `getGroupProgress`, `getGithubStats`, `updateTaskStatus` had no ownership/membership checks. | ✅ Fixed (`checkGroupAccess`) |
| S3 | **High** | `getAllTasks` returned every task in the DB to any admin. | ✅ Fixed (scoped to `created_by`) |
| S4 | **High** | Tokens in `localStorage` → any XSS steals both access and refresh tokens. | ⚠️ Mitigated by CSP (§6a); httpOnly cookie still planned |
| S5 | **Medium** | EOM score and snapshot taken from client input and stored unverified. | ✅ Fixed (recomputed server-side) |
| S6 | **Medium** | No refresh-token rotation or reuse detection. | ✅ Fixed |
| S7 | **Medium** | No brute-force protection on login. | ✅ Fixed (5 failures / 15 min, separate login and register limiters) |
| S8 | **Medium** | Socket auth token never re-validated on long-lived connections. | ✅ Fixed (disconnect at token `exp`) |
| S9 | **Medium** | `ssl: { rejectUnauthorized: false }` on the Postgres connection. | ✅ Fixed (full verification for non-local DBs) |
| S10 | **Low/Med** | No input validation framework: register accepts empty/weak passwords and unvalidated emails; profile update accepted arbitrary strings. | ⚠️ Profile now validated; register still unvalidated |
| S11 | **Low** | Refresh tokens stored in plaintext; `refresh_tokens` never pruned. | ⚠️ Now hashed (SHA-256); still never pruned |
| S12 | **Low** | CORS origins + socket CORS origins hardcoded and duplicated in two files. | ❌ Open |
| S13 | **Low** | `admin` can view any employee's stats regardless of team. | ❌ Open |
| S14 | **Info** | No secrets committed (good); but no startup check that required secrets exist. | ❌ Open |
| S15 | **High** | *(Found Nov 2026)* Any admin could read and post comments on any task (only employees were restricted). | ✅ Fixed (`canAccessTask`) |
| S16 | **High** | *(Found Nov 2026)* Any admin could delete any attachment by ID. | ✅ Fixed (task ownership + attachment/task match) |
| S17 | **High** | *(Found Nov 2026)* Anyone can register as admin, and `GET /invitations/available-employees` returned the name and email of every unassigned employee. | ✅ Fixed (endpoint removed; invite by exact email; 20 invites/hour; 7-day re-invite cooldown) |
| S18 | **Medium** | *(Found Nov 2026)* `linkedin_url` was unvalidated and rendered as `<a href>`, allowing a stored `javascript:` URL. | ✅ Fixed (server validation, safe href on the client, migration clears existing bad values) |
| S19 | **Medium** | *(Found Nov 2026)* Vulnerable dependency versions (1 critical, several high) in both packages. | ✅ Fixed (`npm audit fix`, unused `morgan` removed; 0 production vulnerabilities) |
| S20 | **Medium** | *(Found Nov 2026)* No security headers or CSP on the frontend. | ✅ Fixed (§6a) |
