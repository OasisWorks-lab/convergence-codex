# Phoenix Core: character dashboard foundation

Status: proposed architecture and static interface preview. No live authentication or database actions have been deployed.

## Requirements from the Convergence owner
- Keep the Codex, dashboard source, bot source, and database migrations together in the convergence-codex GitHub repository.
- List eligible registered Discord players; select a player to see character cards; select a character to see its sheet.
- Players may propose edits to their own character records. No edits take effect until the owner approves them.
- The owner alone can change bot settings or approve/deny player proposals. The bot notifies the owner within Discord.
- Characters have independent progression, equipment, inventories and wallets; never pool them across characters.
- The RPG hybrid progression design is still provisional, so attribute names and calculations must be configurable/migratable.
- Existing Codex pages, the theme system and offline Owner Studio must remain intact.

## Hosting boundaries
GitHub Pages hosts static HTML, CSS, images and browser JavaScript. It cannot execute a Discord bot, secure private OAuth operations, or host a transactional database. Keep the frontend source in this repo, but deploy the backend and bot separately.

Possible production services:
- Dashboard frontend: same Codex project, with a separately deployed dynamic application origin or proxy.
- Backend: Cloudflare Workers/Pages Functions or another HTTPS API runtime.
- Storage: Cloudflare D1/SQLite or PostgreSQL, private to backend.
- Phoenix Core: a running Discord application process, using an environment-held bot token.
- Authentication: Discord OAuth2 Authorization Code flow handled by the backend.

## Authorization rules
- Identify Discord users by stable user ID, never display name.
- Validate OAuth state, use secure HttpOnly session cookies, implement CSRF protection, and verify guild membership when appropriate.
- Character update endpoints must check the authenticated user's ID matches the character owner ID.
- The owner's Discord user ID must be configured privately on the server, not in public HTML.
- Approval, denial, and bot settings changes must check the owner's authenticated identity on every request, including Discord button interactions.
- Publish only characters and fields approved for public visibility; player-directory policies should be explicit.
- No bot token, OAuth client secret, database URL, or character private data belongs in this public repository.

## Proposal/approval lifecycle
1. A player signs in using Discord.
2. The backend fetches that player's character and checks ownership.
3. The player submits a field-specific patch and a reason/evidence. The approved sheet remains unchanged.
4. The backend stores a PENDING proposal with the character's version number.
5. Phoenix Core notifies the owner in Discord with request details and secure review actions.
6. Only the owner can approve or deny. Approval checks request status and base character version in the same database transaction that applies the change and logs the action.
7. Conflicting or stale proposals cannot silently overwrite newer approved information.
8. The player sees the result and a durable history of all decisions.

All player-editable fields should be whitelisted and validated; special systems such as wallets, items, transformations, techniques and gear require the same owner approval rules.

## Logical API
GET /api/session
GET /api/players
GET /api/players/:discordId/characters
GET /api/characters/:characterId
POST /api/characters/:characterId/requests
GET /api/me/requests
GET /api/owner/requests
POST /api/owner/requests/:requestId/approve
POST /api/owner/requests/:requestId/deny
GET /api/owner/settings
PUT /api/owner/settings

All API paths above are a design contract, not implemented endpoints.

## MVP development order
1. Confirm the Phoenix Core bot runtime/framework and bot-hosting plan.
2. Implement authentication, private database and ownership checks.
3. Replace fictional preview data with API reads.
4. Implement versioned proposals, review transactions, Discord owner notifications and audit logs.
5. Add owner settings endpoints and permissions.
6. Test mobile UX, private-data boundaries, replay/idempotency, concurrency, backups and restore.

## Demo limitations
The new dashboard/index.html preview uses fictional characters and a local, in-memory request simulation. It cannot authenticate anyone or send real change requests. The owner review area is demonstrative only; it never authorizes an action. Do not use browser JavaScript as a trust boundary.
