# SmartTrade Backend (local MS-SQL)

This backend is a minimal Node/Express app that connects to a local MS-SQL `trade` database using Windows Authentication.

Connection centralization:
- All DB connections use `db/connection.js`. Update the server name or database there — it's the single source of truth for DB connectivity.

Windows auth settings (default):
- Server name: `DESKTOP-SNB3ISR`
```markdown
# SmartTrade Backend (local MS-SQL)

Minimal Node/Express backend for SmartTrade. The app connects to MS-SQL using the `mssql` (tedious) driver by default and reads DB connection info from environment variables.

Connection centralization:
- All DB connections use `db/connection.js`.

DB configuration (environment variables):
- `DB_USER` — SQL login user (optional; set with `DB_PASS` for SQL auth)
- `DB_PASS` — SQL login password (optional; set with `DB_USER` for SQL auth)
- `DB_SERVER` — SQL Server host (default: `DESKTOP-SNB3ISR`)
- `DB_NAME` — Database name (default: `trade`)
- `DB_INTEGRATED` — set `true` to force Windows Integrated Auth (default behavior when SQL creds are not provided)

Environment file:
- The backend loads `backend/.env` automatically via `dotenv`.
- Use `backend/.env.example` as a template.

Quick setup (recommended — pure JS driver):

1. From the `backend` folder install dependencies:

```powershell
cd backend
npm install
```

2. (Optional) Create the `trade` database if it doesn't exist (use SSMS or `sqlcmd`):

```sql
CREATE DATABASE trade;
GO
```

3. Configure `backend/.env` (recommended):

```dotenv
DB_INTEGRATED=true
DB_SERVER=DESKTOP-SNB3ISR
DB_NAME=trade
```

Or set DB environment variables in PowerShell:

```powershell
$env:DB_USER = 'sa'
$env:DB_PASS = 'your_password'
$env:DB_SERVER = 'DESKTOP-SNB3ISR'
$env:DB_NAME = 'trade'
```

4. Initialize tables (creates `Users` and `Portfolio` if missing):

```powershell
npm run init-db
```

Default app login created by seed script:
- Username: `sa`
- Password: `sa`
- Role: `superadmin`

5. Start the backend:

```powershell
npm start
```

Notes on Windows Integrated Auth and native driver:
- The repo previously used `msnodesqlv8` (native driver) for Windows Integrated Authentication. That driver requires Visual C++ build tools and native compilation.
- If you prefer Integrated Auth, either install the full "Desktop development with C++" workload and add `msnodesqlv8` to `package.json`, or continue using `mssql`/`tedious` and run DDL with `sqlcmd -E` (integrated auth) as demonstrated when applying schema updates.

API examples:
- `POST /api/register` — body: `{ "username": "sa", "password":"sa", "fullname":"Demo", "email":"a@b.com", "phone":"+91...", "address":"..." }` returns `{ token }`.
- `POST /api/login` — body `{ username, password }` returns `{ token }`.
- `GET /api/portfolio` — requires `Authorization: Bearer <token>` header.
- `GET /api/market/ticker` — sample market data.

Security reminders:
- Replace `JWT_SECRET` with a strong secret in your environment for production.
- Do not commit real credentials to source control. Use environment variables or a secrets manager.

```
