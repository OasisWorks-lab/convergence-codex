# PhoenixCore for Convergence: Phoenix Rising

PhoenixCore adds a Discord player directory and character sheets to the Convergence Codex. Players can propose changes to their own characters. Players also submit custom designs and training scenes. Helpers judge rewards and approve requests. Gabe reviews every Helper denial.

## Try the directory

Open **PhoenixCore** in the Codex navigation. In a downloaded copy of the repository, open **phoenixcore/index.html**. Practice mode uses four fictional Discord members and resets when the page reloads.

1. Choose **Ember Quill**, then **Rin**. Open **Propose edit**, change Speed, describe the update and requested approval, enter the reason and submit.
2. Open **View approved sheet** to see the current value. Select **Owner** in the practice bar, open **Requests** and choose Rin’s request. Read the two values and press **Practice approve**.
3. Switch to **Helper**, open Rin’s sheet and choose **Judge a reward**. A 12.5% award on 10,000 Base Power Level gives 1,250 points. Add gear or currency if earned, enter the judgment and submit. Approve as the practice owner. Sola, the same writer’s second character, keeps her own balance and gear.

With a live service configured, the directory opens with Discord sign-in. Helpers and the owner can decide requests on the website or Discord review card.

## Submissions and approvals

Open **New Submission** in the directory or on the Codex homepage. The dropdown starts on **New Character**. Switching types keeps your unfinished answers in this tab until you submit or reload. Old approved sheets can be updated one field at a time.

| Submission | What the player sends | What approval does |
| --- | --- | --- |
| New Character | OC or NPC, history, family, enemies, occupation, characteristics, path, class, personal traits, non-racial techniques or items, and sheet stats. Backstories support 60,000 characters. Enter at least three distinct strengths and three distinct weaknesses. | Creates this character’s sheet, wallet and gear inventory. |
| Technique | Name, ULT / SUP / SPT / STK classification, appearance, description, requirements and drawbacks. | Adds an approved technique to the design collection. |
| Item | Description, lore, appearance, abilities, limitations, optional energy source, type, cooldown, companion systems, both Intelligence values and designer notes. | Adds an approved item design. The form shows all five Intelligence tiers and flags when mentorship or assistance may be needed. |
| Race | BPL dice proposal, homeworld, lifespan, alignment, up to four racial mechanics, forms, factions, hybrid potential, perks, history and culture. | Adds an approved race design. Each transformation can be submitted separately. |
| Transformation | Form name, race or universal path, appearance, aura, story, requirements, drawbacks, multiplier and additional effects. | Adds an approved form with its proposed mechanics. |
| OC Update Request | One of the writer’s approved characters, the changed fields, a description, a reason and the precise approval requested. | Applies the reviewed differences to that sheet revision. |
| Training Submission | Character, scene location, training type, goals, claimed boosts, formula, requested gains and an optional Convergence message link. | After staff assess the scene and a reviewer approves, PhoenixCore applies the adjudicated award to the named character. |

**Requests** shows the submission and its decision. The four types of approved design appear under **Approved designs**, where members can read the full entry. A player’s equipment remains on that character’s sheet. Staff see the training queue and can judge a claim using a fixed BPL amount or a percentage, plus individual stat gains, currency and gear. The review retains the original claim, the staff member’s judgment and the approved changes.

For example, a player can claim 500 BPL and two points of Ki Control. A judge can grant 300 BPL and one point of Ki Control. Gabe sees both versions. Approving adds 300 BPL and one point of Ki Control to that character. Recording the judgment enables approval on the same review card and on the website.

## Character economy foundation (Zeni)

PhoenixCore's first economy slice adds character-specific cash and bank balances backed by a private SQLite/PostgreSQL ledger. It does not create a shared player wallet. New player characters can submit an optional **Societal class** in the existing owner-reviewed character form: Low (1,000 Zeni), Middle (2,000), High (4,000), or Noble (8,000). This is independent of combat class. The grant happens **once when the character is approved**; editing or approving an existing sheet cannot grant it again. Existing sheets without a societal class retain their existing wallet and receive no retroactive class bonus.

Existing character `wallet` values are imported into a cash account once; the original sheet continues to show a synchronized cash value for compatibility. Approved training currency awards update the account and create a ledger entry in the same transaction. Bank deposits and withdrawals explicitly operate on the selected character's own account. A second OC belonging to the same player has a separate account and ledger. Authenticated players can read their own statements, while Helpers and the owner can inspect statements for review.

Authenticated API:
- `GET /api/state`: includes `economyAccounts` limited to the current player's characters or authorized reviewers.
- `POST /api/economy/bank`: `{"id":"<UUID>","characterId":"<UUID>","action":"deposit"|"withdraw","amount":"123"}`. Idempotency keys prevent double processing on retries. Each transaction bumps the selected character's sheet revision to invalidate stale edit requests.
- `GET /api/economy/characters/<UUID>/statement`: last 100 ledger events, authorized by character ownership or reviewer access.

The original and shared character sheet are retained. This slice intentionally **does not** activate overdrafts, negative balances, freezes, bank interest, trading, shops, passive RP income, or a global administrator economy dashboard. Those require the separately approved policy and integration phases; the unresolved negative-balance semantics must not be guessed.

## Run the service

The web pages, bot and tests live together in this repository. GitHub Pages serves the dashboard. An always-running Node service receives Discord interactions, processes approvals and stores records. The existing Codex Studio continues to handle lore editing.

Use **Node 24.12 or newer**. Deploy the repository on a host that can run a persistent Node process and expose HTTPS. Use the repository root as the checkout so the service has access to the sibling dashboard and Codex assets.

| Setting | Value |
| --- | --- |
| Working directory | `phoenixcore-service` |
| Install command | `npm install --include=optional` |
| Start command | `npm start` |
| Health check | `/health` |
| PostgreSQL | Run `npm install --include=optional` and set `DATABASE_URL` to the private database connection string. |
| Single-instance SQLite | Set `SQLITE_FILE` to a file on a persistent volume, for example `/var/data/phoenixcore/convergence.sqlite`. Node supplies the driver. |

For a local first run, open a terminal in `phoenixcore-service` and copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell). Fill in the settings below. `npm start` then serves the dashboard at `http://localhost:4100/phoenixcore/`. Discord needs a publicly reachable HTTPS interaction endpoint for live approval buttons. Locally you can run `npm test` or open the practice dashboard without Discord credentials.

### Start the existing Bot-Hosting.net deployment

1. In the deployment, open **Settings → GitHub**. Verify that **Repository** shows `OasisWorks-lab/convergence-codex` on `main`, then click **Pull now**. When the panel says **Up to date**, the **Files** tab should show `index.js`, `package.json`, and `phoenixcore-service` in the top folder.
2. In **Startup**, keep **Entry File** set to `index.js` and select Node **24.12 or later**. The top-level package installs PhoenixCore's dependencies. Leave `PORT` empty so the bot listens on the port the host supplies.
3. In the deployment's **Environment** tab, enter the Discord settings from the next section. Mark the bot token and OAuth2 client secret as secrets. Also add the three settings below.

| Host setting | Value for Convergence |
| --- | --- |
| `SERVICE_ORIGIN` | `https://xr65xgo3xl.apps.bot-hosting.cloud` |
| `DASHBOARD_URL` | `https://oasisworks-lab.github.io/convergence-codex/phoenixcore/` |
| `SQLITE_FILE` | `/home/container/.phoenixcore/convergence.sqlite` |

4. Click **Start**. The console should say `PhoenixCore is listening on port` followed by the assigned number. Open [the health check](https://xr65xgo3xl.apps.bot-hosting.cloud/health) and look for `{"ok":true}`.
5. In the Discord Developer Portal, add `https://xr65xgo3xl.apps.bot-hosting.cloud/auth/callback` under **OAuth2 → Redirects**. Save `https://xr65xgo3xl.apps.bot-hosting.cloud/discord/interactions` under **General Information → Interactions Endpoint URL**. Open the [player dashboard](https://oasisworks-lab.github.io/convergence-codex/phoenixcore/) and sign in with Discord.

### Connect the Discord application

1. Open your **PhoenixCore** application in the Discord Developer Portal. Under **General Information**, copy **Application ID** into `DISCORD_CLIENT_ID` and **Public Key** into `DISCORD_PUBLIC_KEY`.
2. Under **Bot**, put the bot token in the private host’s `DISCORD_BOT_TOKEN` setting (existing installations can keep `DISCORD_TOKEN`). Enable **Server Members Intent** so PhoenixCore can list members who have never signed in. Under **OAuth2**, put the client secret in `DISCORD_CLIENT_SECRET`.
3. Enable **Developer Mode** in your Discord client’s **Advanced** settings. Copy your own **User ID** into `DISCORD_OWNER_ID`. Copy the Convergence server’s **Server ID** into `DISCORD_GUILD_ID`. PhoenixCore checks the numeric owner ID when saving settings or deciding requests.
4. Set `SERVICE_ORIGIN` to the HTTPS origin of your Node service. Under Discord **OAuth2 → Redirects**, register the exact origin followed by `/auth/callback`. For local sign-in, register `http://localhost:4100/auth/callback` separately.
5. Install the bot in **Convergence: Phoenix Rising** using the application’s **Guild Install** link and the **bot** scope. Give PhoenixCore **View Channel**, **Send Messages**, **Read Message History** and **Embed Links** in the review channels. Also grant **Send Messages in Threads** in the forums.
6. Start the service. Under Discord **General Information → Interactions Endpoint URL**, save the public service origin followed by `/discord/interactions`. Discord checks the signature and ping handshake during setup.
7. Set `DASHBOARD_URL` on the host to the precise published dashboard address, including the trailing slash. The standard Pages address for this repository is `https://oasisworks-lab.github.io/convergence-codex/phoenixcore/`. If you publish on a custom domain, use that address. In **phoenixcore/config.js** set `window.PHOENIXCORE_API` to the public HTTPS service origin and publish that change with the site.
8. Sign into the dashboard as yourself and open **Bot settings**. Set your optional **Player role ID** and **Helper role ID**. The character submissions channel, design submissions channel and OC updates forum are prefilled for Convergence. Approve a new character from its Discord review card and open the player’s OC Updates forum post. Submitting a new edit gives you a before-and-after comparison.

Keep your bot token, client secret and database credentials in your host’s secret settings or local ignored `.env`. The public dashboard configuration holds only the HTTPS service address. Put the SQLite database on backed-up storage outside the Pages publishing directory. Use a separate database for each server installation.

[Discord Developer Portal](https://discord.com/developers/applications) · [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2) · [Guild member listing](https://docs.discord.com/developers/resources/guild#list-guild-members) · [Discord interactions](https://docs.discord.com/developers/interactions/receiving-and-responding) · [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

## Character-based NPC scene turns

In a configured RP channel or forum thread, start an NPC scene with `/roleplay-start`. Choose **character** when you control multiple approved OCs. Each approved character may occupy its own turn slot, even when the same Discord account controls several characters. An owner with no playable OC can still start an administrative NPC scene without selecting one.

Use `/roleplay-join character:<your character>` to join an existing scene. You can join again with another approved OC, but cannot join twice with the same character. The **Join scene** button can automatically select a character if you have exactly one; otherwise, use the slash command to choose. New arrivals during NPC delivery join the following round. The 12-slot limit applies to characters, not Discord accounts.

Each turn displays the selected character's name beside the real writer's Discord mention. Post as **that specific character** with the approved tag or the channel's character default; another character's posts do not consume their turn. Complete each character's turn separately with `/finish-turn`. The two-hour unanswered-turn deadline is tracked for each turn, and notifications mention the real writer. Legacy scenes created before character-specific slots remain compatible.

## Posting as a character in Discord

1. To enable character posting, switch on **Message Content Intent** on PhoenixCore’s **Bot** page in the Discord Developer Portal. Set `DISCORD_RP_ENABLED=true` on the host and restart the service. The basic directory and review service can run on their own.
2. For each selected RP channel grant the bot **View Channel**, **Send Messages**, **Read Message History**, **Manage Webhooks** and **Manage Messages**. Give it **Send Messages in Threads** for a selected thread and webhook access on the parent channel. In **Bot settings**, choose **Roleplay divider category**. The marker’s own channels are excluded. Every category below it supplies its channels and their threads. Channel moves, category reordering, thread creation and deletion take effect through Discord’s gateway. A missing divider pauses automatic posting. The coverage list shows IDs and missing bot permissions, and indexes archived threads visible to PhoenixCore. With no divider, the manual channel IDs apply.
3. Each character sheet displays its posting tag. Writers can set one during creation, in **Propose edit**, or under **Posting preferences** on their own sheet. A tag-only edit takes effect immediately. If a portrait or any other sheet field changes too, a reviewer sees the entire edit. A later tag edit cannot be overwritten by an older pending request. With the tag `rin`, type `rin Your move.` in an enabled channel. Optionally select Rin as that channel’s default and type `Your move.` directly. Type `sola I’ll take the next watch.` to switch for one message. Use `//` or `((` at the start to send an out-of-character message under your Discord name. Tags preserve their spelling and punctuation. Words, spaces, symbols and emoji are supported, for example `[Ash]`, `⭐` or `test-`. Matching ignores letter case, uses a word boundary for names, and picks the longest matching tag. An explicitly chosen tag takes priority over the out-of-character prefix. A forum default carries into its posts. Select a thread to override it, **Inherit parent default** to remove an override, or **My Discord account** to opt out there.
4. PhoenixCore posts supported text with the approved character name and portrait and keeps an attribution record. Staff can paste the resulting Discord message ID or link into **Directory → Look up writer** to see the writer. Replies, attachments, stickers and polls stay in Discord under the writer’s account. The original is removed only after Discord confirms the new post and PhoenixCore records it. If delivery is uncertain, the writer retains the original. Regular messages can also be linked as training evidence.

Character creation, OC updates, races, techniques, items and transformations accept PNG, JPEG, WebP and GIF uploads up to 5 MiB or a direct HTTPS image link. Uploads are stored with their original bytes in the service database; include that database in backups. A saved upload URL is readable by anyone who has the link, including Discord. The approved portrait is used on the sheet and on subsequent character webhook posts. Existing messages keep their original appearance.

## How live sheets work

- **Directory.** Current Convergence members sign in through Discord. Everyone in the guild can read the directory after signing in. By default every human member appears, including members with zero sheets. Set a player role to list just that group. Members are identified by their stable Discord ID and displayed with their current username and display name. The roster refreshes within roughly 30 seconds of the next request.
- **Player edits.** A player can submit a new character or propose changes to an existing one. Fields include name, lineage, portrait, background, Base Power Level and narrative attributes. A correction to BPL goes through review. Judges enter an earned training percentage through **Judge a reward**. Writers see their own requests and awards. Helpers and Gabe see the whole queue.
- **Discord reviews.** New characters go to `1572638034359226558`. Techniques, items, races and transformations go to `1572638183991283904`. In a forum, each submission gets a post with its review card. Approving a character opens a single post named `{Discord username}'s OC Updates` under `1572638583930626250`. PhoenixCore saves its ID by player account and forum. All of that player's OC updates, training claims and staff awards go there, including for other characters. Existing players get their post on their next submission requiring it. An unlocked archived post reopens as needed. A deleted thread is replaced on the next submission. Locked threads or permission errors keep delivery queued for retry.
- **Review decisions.** Helpers and Gabe can approve or deny on the website or in Discord. A Helper denial opens owner review and queues a DM to Gabe. Upholding a denial closes the request. Vetoing approves a complete, judged request or reopens an incomplete or unjudged request at its previous stage. Training first offers **Review training** for staff to enter their judgment. The same card gains approval controls after judgment and shows the final decision. Tag-only edits still take effect immediately. The owner can check delivery under **Requests** and change the three destinations in **Bot settings**.
- **Concurrent edits.** Approval applies once to the exact sheet revision the reviewer saw. If another approved change overtakes that revision, the second approval marks the request **Outdated**. The submitter can open the current sheet and submit an updated proposal. A declined request retains its decision history.
- **Wallet and gear.** Each character starts with a separate zero balance and empty inventory. Each award names one character. Approval updates only that character’s wallet, gear and BPL. There is no shared wallet or reward transfer between a player’s characters. **Credits** is the initial, owner-editable currency label.
- **Training math.** A judge enters a fixed BPL gain or one final adjudicated percentage with up to two decimal places. PhoenixCore uses whole-number arithmetic and rounds the gain down once. It previews the resulting BPL and checks the same calculation and revision on the service. Judges can incorporate scene rules and caps before submitting the percentage. Multi-award stacking, cap transitions and transformation rules remain decisions for the RPG design.
- **Sign-in.** The service requests Discord’s `identify` scope and checks guild membership using its bot account. The browser receives a short-lived, single-use login ticket bound to that tab’s verifier. Discord credentials stay on the service. Dashboard sessions are revoked on sign-out and are remembered on this browser for 30 days, renewed during use.

## Verify

Use `npm test` in `phoenixcore-service` for the service and Discord interaction tests. These run with an isolated SQLite database and a simulated Discord API. To exercise PostgreSQL too, set `PHOENIX_TEST_DATABASE_URL` to a dedicated **test** database before running the suite. It creates tables and test characters.

The browser walkthrough test runs with Python Playwright and Chromium. From the repository root run `python -m pip install playwright==1.56.0`, `python -m playwright install chromium`, then `python phoenixcore-service/test/dashboard_browser.py`. The GitHub workflow checks SQLite, PostgreSQL and the desktop/mobile practice flows, including long-form submissions, RP preferences and both stages of training review.


## Editing the Codex and world atlas

Sign in on any public Codex page. The header shows **Edit Mode** to Convergence members with Discord role `1100315883773112432`. The service fetches current guild membership for every save. An editor opens **Edit content** to change published entries, page text, race and form records, systems, chronicles, and theme palettes. Choose **Site settings** for the default reader theme. **Publish changes** writes a versioned entry to the same persistent database as PhoenixCore. The next page load reads it on top of the bundled archive. Back up that database with the character sheets.

A world card opens **Lore**, **Location Guild(s)** and **Mystical Items**. Each guild and item has its own shareable location URL. In Edit Mode, use the button in each section or detail page to add or edit records. Empty lists stay empty until an editor publishes entries.

## Characters and request history

- Open **Directory → player → character → Owner controls** to remove a sheet. This clears that character’s tag, form and posting defaults, closes outstanding changes, and preserves historical requests and message attribution.
- **Requests** contains submissions and approved designs. Final decisions are automatically archived. The owner can pause or restore an open request and permanently delete an archived request record. The approved sheet and published design survive deletion.
- Submit an attained form and optional form portrait from a character’s submission or update. After approval, use Discord’s `/transform` command and choose the character and form. Use /revert-form for Base or an earlier attained form. Subsequent RP posts use the character and form names with that form’s portrait. Active Power Level and numeric attributes apply the approved multiplier or stat adjustments. Record forms in attainment order from lowest to highest. Numeric multipliers round down to whole points.
- On a relayed Discord post, right-click or long-press and select **Apps → Character sheet**. The private response shows Base Power Level, approved attributes, active form and a link to the full sheet.


## Helper review and Discord intake

Set the Helper role and notification text in **Bot settings**. The notification recognizes `{helper}`, `{player}`, `{type}` and `{character}`. A Helper mention is included when a review opens. Enable role mentions for PhoenixCore in review channels if the Helper role is unmentionable. **Staff checks** returns an ephemeral Discord response. The website shows the same assessment to reviewers. Checks cover template completeness, personal traits, item Intelligence, backstory metrics and optional owner guidance. Set paragraph, sentence and word minimums to zero to leave them undecided. A reviewer judges the writing and roleplay balance.

New player-authored template posts in the configured review channels and the writer’s OC Updates thread appear under **Requests**. A complete template enters normal review. Select **Complete Discord submission** to finish an incomplete template from its original text. Writers can also start a post with `pc!submit item` (or another submission type). For an existing post use Discord’s message **Apps → Catalog submission** and choose its template. This preserves the writer, source link, text and available attachments.

The Owner role can change **Selectable character paths** in race Edit Mode. The bot owner with that role can also manage paths together in **Bot settings → Character paths by race**. Set a server nickname and command prefixes in **Bot settings**. Use **Discord embeds** to preview and save guidelines or welcome drafts, then choose **Publish to Discord** to post to a text channel or thread. Publishing to the same channel updates the existing message.


## NPC roleplay in Discord

Choose **Directory → NPC catalog** on the dashboard to see approved NPC sheets. King Azurik is seeded as a server NPC record and appears **only in the NPC catalog**, not under the owner’s playable characters, posting preferences, or submissions. His existing approved biography and family ties remain the only basis for any prior acquaintance; a writer’s Discord profile name does not prove that Azurik has heard it. The reboot begins with every Chronicle and Saga unplayed.

1. In an enabled RP channel or forum post, use `/roleplay-start` and choose an NPC. Open roleplay follows the writers’ premise. Audience and Training spar are optional styles. The `context` option reads the most recent 0–50 messages from that exact channel or thread. It defaults to 5. Zero starts fresh. PhoenixCore skips commands, OOC and its own turn notices.
2. PhoenixCore posts **one standing scene embed** in the RP channel, including the opening and current turn order. Click **Join scene**, or use `/roleplay-join character:...` to choose among multiple approved characters. New joins and turn handoffs edit that same message in place without sending channel announcements. Joining while the NPC is replying puts you in the next round.
3. On your turn, write with your saved PhoenixCore character tag or channel default. Send as many parts as you need within the existing 12-post, 10,000-character turn limit, then use `/finish-turn`. There is **no immediate ping** on handoff or round start. If you have not finished or passed within **30 minutes**, PhoenixCore sends one reminder mentioning your real Discord account. An unanswered turn still automatically passes after two hours; once you post in character you have time to finish. **Pass turn** hands off early and preserves anything already written. If a whole round passes in silence, a joined writer can resume by posting or selecting **Resume scene**.
4. After the writers finish, the NPC posts in character, using its display name and portrait through the RP webhook. Reply length follows the average amount each writer contributed that round. Try asking Azurik to show his Super Saiyan form, then to stand down. A form change displays the current published form artwork. An individual form portrait takes precedence for the webhook avatar. Scene transformations and PL belong to that encounter.
5. `/roleplay-status` shows the order, available controls and the NPC’s current form and PL. The initiator or a Discord administrator can pass a writer or end the scene with `/roleplay-cancel`. Turns, captured writing and deadlines survive restarts.

Keep `DISCORD_RP_ENABLED=true` on the host. The roleplay health endpoint at `/health/roleplay` reports the gateway and guild command registration. Discord needs permission to send messages, read channel history, embed links and post in threads. Manage Webhooks enables the NPC’s own Discord display name and portrait. With standard posting permissions the bot can also use an attributed character embed.

### Real AI narration — OpenAI or Gemini

The bot's original *Guided* mode uses authored fallback dialogue and is not a general language model. When an AI provider is configured, **AI dialogue becomes the default for newly started scenes**; choose `dialogue: Guided` to opt out. A configured daily budget limits the number of attempted AI replies; a provider outage or exhausted budget falls back to a short guided response rather than stalling the scene. API billing and quota are separate from your ChatGPT subscription.

Set these **only in Bot-Hosting.net → PhoenixCore → Environment**, not in GitHub, Discord, or a public file:

| Environment variable | OpenAI | Gemini |
| --- | --- | --- |
| `PHOENIX_NPC_AI_PROVIDER` | `openai` | `gemini` |
| `PHOENIX_NPC_OPENAI_KEY` | Your OpenAI API key | — |
| `PHOENIX_NPC_GEMINI_KEY` | — | Your Gemini API key |
| `PHOENIX_NPC_OPENAI_MODEL` | `gpt-4.1-mini` (or another accessible model) | — |
| `PHOENIX_NPC_GEMINI_MODEL` | — | `gemini-2.5-flash` (or another accessible model) |
| `PHOENIX_NPC_AI_DAILY_REPLIES` | e.g. `40` | e.g. `40` |

Restart the Node service after updating its environment, then open **a new scene** with `/roleplay-start`. Existing scenes retain their previously selected dialogue mode. The older `PHOENIX_NPC_AI_MODEL` variable remains accepted for compatibility. The AI mode is available only while its configured provider credentials and daily cap are valid. The bot does not send keys to the frontend. Discord posts, NPC biography, scene context, and verified story memory may be transmitted to the selected API provider; inspect that provider's terms, data usage and billing controls before enabling it. Prefer explicit provider spending limits.

### Free-model backups and growth toward 30 Discord members

PhoenixCore is one Discord server with **one shared pool** of AI capacity. A character takes one active turn at a time, and the NPC produces one reply per completed round. Neither every Discord message nor every character in a scene independently makes an API call. There is **no mandatory per-member quota**: some players can use NPCs more often than others.

When `PHOENIX_NPC_AI_PROVIDER=gemini`, the configured fallback sequence is:

1. `gemini-2.5-flash`, the preferred quality model.
2. `gemini-2.5-flash-lite`, on the **same Gemini API key** and potentially a separate per-model allowance.
3. Groq `openai/gpt-oss-120b` **only if** the optional `PHOENIX_NPC_GROQ_KEY` is configured on a Groq **Free** plan.
4. OpenRouter `openrouter/free` **only if** `PHOENIX_NPC_OPENROUTER_KEY` is configured. Its free-account pool is shared across all free models and is typically 50 requests/day.

No automatic fallback to OpenAI is permitted because it isn't a free provider. For OpenRouter, paid model identifiers are rejected. **No software can guarantee a zero bill if your Gemini or Groq account has paid billing enabled**: confirm each upstream project is genuinely free-tier. External providers receive the NPC and relevant scene text when used. Their privacy terms may differ.

Environment variables (credentials go **only** in the private Bot-Hosting.net Environment panel):

| Variable | Example / meaning |
| --- | --- |
| `PHOENIX_NPC_AI_PROVIDER` | `gemini` (recommended primary) |
| `PHOENIX_NPC_AI_DAILY_REPLIES` | `20` while testing; shared **AI turns attempted**, not a member allowance |
| `PHOENIX_NPC_AI_FREE_FALLBACKS` | `gemini-lite,groq,openrouter` (default; omit providers to disable) |
| `PHOENIX_NPC_GEMINI_LITE_MODEL` | `gemini-2.5-flash-lite` (default) |
| `PHOENIX_NPC_GROQ_KEY` | Groq Free-plan key, only if you choose to connect Groq |
| `PHOENIX_NPC_GROQ_MODEL` | `openai/gpt-oss-120b` (current supported Free-plan model) |
| `PHOENIX_NPC_OPENROUTER_KEY` | OpenRouter key, only if you choose to connect it |
| `PHOENIX_NPC_OPENROUTER_MODEL` | `openrouter/free` (default, free-only) |
| `PHOENIX_NPC_GEMINI_DAILY_REPLIES` | Conservative local Flash request allowance; default 20 |
| `PHOENIX_NPC_GEMINI_LITE_DAILY_REPLIES` | Conservative local Flash-Lite allowance; default 50 |
| `PHOENIX_NPC_GROQ_DAILY_REPLIES` | Conservative local Groq allowance; default 200 |
| `PHOENIX_NPC_OPENROUTER_DAILY_REPLIES` | Conservative local OpenRouter allowance; default 40 |
| `PHOENIX_NPC_GEMINI_RPM` / `PHOENIX_NPC_GEMINI_LITE_RPM` | Local requests/minute: default 3 each |
| `PHOENIX_NPC_GROQ_RPM` / `PHOENIX_NPC_OPENROUTER_RPM` | Local requests/minute: default 8 each |

These are **conservative bot safeguards**, not a promise of provider quota. Upstream limits vary by project, token usage, availability, and service terms. If an upstream provider returns 429 or becomes unreachable, PhoenixCore records a **model-specific cooldown in the database** and tries the next configured model, up to four models in one turn. Failed calls consume the provider's own request allowance; the shared global counter increases just once per attempted NPC turn. Provider safety refusals do not trigger further model-hopping. If all models are unavailable, the existing short Guided dialogue is labeled as an offline fallback in the Discord NPC post.

For a future 30-member server, avoid hard-coding `20` permanently. After you have verified free-tier quotas in each provider's console, raise `PHOENIX_NPC_AI_DAILY_REPLIES` to a **realistic measured shared allowance**, perhaps beginning around `150` for an active test period. Do not raise it just because the app permits up to 10,000: provider quotas and token-per-day limits still apply. High activity from one player consumes shared pool capacity, but this release does not impose an unapproved per-player quota.

Use the **owner-only** `/roleplay-ai-status` command to inspect each configured model's local daily/minute usage, cooldown, and recent result without revealing any API keys. The status is shared across restarts. If RP volume grows substantially, prioritize expanding genuinely free capacity, transparent model availability, and optional queueing before considering any paid tier.

Official limits: https://console.groq.com/docs/rate-limits and https://openrouter.ai/collections/free-models . Check Google AI Studio's Rate Limits for the actual Gemini project.

### NPC relationship continuity and test scenes

`/roleplay-start memory: Story` (the default for new scenes) records **only successful, witnessed, in-character NPC exchanges** under the actual NPC and character IDs. A later story encounter with the same NPC and the same approved OC can use those recorded posts as verified history. The bot does **not** invent a remembered relationship from username labels or unrelated channel messages. Each OC has independent history with each NPC.

`/roleplay-start memory: Test` is temporary and writes **no** permanent encounter record. This remains true even when a test runs for multiple rounds. Scenes created with older PhoenixCore versions have no memory mode and do not retroactively create permanent memories. Channel backscroll is now **0 by default** instead of 5; you may explicitly request up to 50 context messages, but those are background reading, never automatic evidence that the NPC personally witnessed them.

Use `/roleplay-memory` with the NPC and approved character to inspect up to four recent stored encounters. Only the server owner may choose **Erase memory** for that pair. The owner can also end a scene with `/roleplay-cancel forget: true`, erasing any encounters saved by **that particular scene** without affecting other story meetings. Canceling a normal story scene preserves its existing witnessed encounters unless the owner explicitly chooses to forget. Removing a character or NPC cleans up its linked history.

**Important:** the current test performed before this feature is not automatically remembered by Azurik. You can safely end it with `/roleplay-cancel` and start a new scene with `memory: Test`.



## Community milestone — informational tags and suggestions

The seven November 21 handoffs are audited in [the implementation audit](../docs/PHOENIXCORE_SEVEN_HANDOFF_AUDIT_2026-11-22.md). This milestone provides two independent low-risk Carl-bot-style features **within PhoenixCore**. Existing character proxy tags, NPC scenes, approval routes, economy ledgers, and DISBOARD remain unchanged.

### Informational tags

- All current Convergence members can read public tags using **/tag show** and search them using **/tag search**. These are not character posting tags and never modify player identities.
- Members can use **/tag propose** to submit a new draft privately for staff review. Staff use **/tag proposals** and **/tag review** to approve/decline; approved drafts become public.
- **Owner, native Discord Administrators and configured Helpers** can use **/tag save**, **/tag alias**, **/tag history** and **/tag rollback**. Each edit and restoration is saved as a new immutable numbered revision with editor and timestamp. Staff cannot claim an old revision is a fresh original.
- Published text supports ordinary Discord Markdown/links and safe placeholders **{user}**, **{channel}**, **{date}** and **{server}**. PhoenixCore disallows automatic pings in generated messages. Rich interactive tag builders, conditional roles/fields, and attachment support are separate pending enhancements.

### Member suggestions

- **/suggest create** accepts title and details, with optional **anonymous** submission. Public embeds show no member identity when anonymous.
- Each public suggestion has **Upvote**, **Downvote** and **Remove vote** buttons. The server stores one effective ballot per real Discord user per suggestion; retries don't multiply votes. Members may also use **/suggest vote**, **/suggest list**, and **/suggest view**.
- **/suggest review** permits Owner/Admin/Helper to set Pending, Under Review, Approved, Denied or Implemented, with an optional official response. Every staff transition creates a history record. Staff decisions also enqueue a private DM for the original submitter. Delivery is restart-safe, retried on transient errors, and marked undeliverable when Discord blocks DMs; the staff decision remains committed.
- Anonymous reporters and voters are not exposed to ordinary users by the dashboard or public Discord embeds. Their real identities remain in the private database for authorized anti-abuse investigation; public voting does not reveal voters.
- Suggestion replies do not grant BPL, Zeni, items, ranks, privileged roles or automatic staff approvals. The default is a suggestion **for discussion**, not a binding character/rules change. Follow-up notifications, configured announcement channels, and automatic live edits of older dashboard-created suggestions are additional work, not falsely claimed completed.

### Website and module controls

Authenticated members open **Community** from the PhoenixCore dashboard to browse information tags, submit proposals, view suggestions and cast votes. Authorized staff additionally see pending tag proposals, publishing, rollback and suggestion decisions. Dashboard API endpoints authenticate live Discord members, re-check staff roles using Discord's native Administrator permission or configured Helper role, and never trust hidden buttons as authorization.

The Owner may use **/community-module status** and **/community-module set** or the dashboard module switches. **tags** and **suggestions** can be disabled independently without deleting historical records. The owner, time, previous enabled value and revision are saved on each switch. Both are enabled by default on the first installation of this additive schema. To disable them immediately, use /community-module set.

All data persists through bot restarts in both SQLite and PostgreSQL. Authoritative tables are pc_community_modules, pc_community_module_history, pc_info_tags, pc_info_tag_aliases, pc_info_tag_history, pc_info_tag_proposals, pc_suggestions, pc_suggestion_votes, and pc_suggestion_history.

### Remaining modules

This is the first completed implementation slice, **not** a claim that the 63+40+44+40+60+65+56 requested decisions are already delivered. Continue with shared authorization/jobs, moderation, unified SupportCase, self-roles/panels, approved profile fields, giveaway rewards, economy shops, and saved wheel logic. Do not invent fifth-warning punishments, wheel purchase entitlements, finance overdraft rules or fusion co-control votes.

### Live-test fixes: central suggestion hub and private staff review

**All new suggestions go to Convergence channel ID 1573908218260885614.** Submissions made from another channel with /suggest create or through the Community website queue one central Discord voting embed. The slash command returns a private acknowledgment. The bot records the central message ID and edits it on votes and decisions, with restart-safe delivery and retries.

Give PhoenixCore View Channel, Send Messages and Embed Links permissions in that channel. Previously posted suggestions in other channels are not moved automatically, avoiding duplicate historical posts.

**Private staff decisions:** use /suggest manage with the suggestion ID, or /suggest review without a status. Owner, native Discord Administrators and configured Helpers receive a private ephemeral review embed with Approved, Denied and Implemented buttons. Nonstaff never receive those controls. The server rechecks permissions on every click. Staff may still set a status and response directly with /suggest review. Public suggestion embeds show only the voting controls.

**Informational tag shortcuts:** /tag save and /tag show are still registered as subcommands. PhoenixCore additionally provides top-level /pc-tag-save for staff and /pc-tag-show for members in case another app's /tag command or Discord client search obscures the grouped subcommands. Restart the bot to refresh registered commands.

**Owner suggestion removal:** Community now has Remove suggestion and Restore suggestion actions. Removed suggestions disappear from ordinary website listings, cannot be voted on, and are deleted from their canonical Discord channel after the delivery worker runs. The audit trail and votes remain privately stored; restoring a suggestion makes it visible and republishes it in the central channel. This is reversible archival, not permanent data erasure.

New additive tables: pc_suggestion_posts and pc_suggestion_removals. No pre-existing RP, economy, or character records are replaced.

## Owner/Admin moderation records and durable reminders — phase 1

PhoenixCore now has the **private moderation-case foundation** approved in the Dyno handoff. This release deliberately starts with non-punitive records: it does **not** implement automatic bans, timeouts, kicks, anti-nuke, spam detection, or the unresolved five-warning sanction.

### Staff authority and attribution

- **Owner and native Discord Administrators** can use the private moderation commands. **Helpers cannot** use general moderation merely because they can review character requests or support tickets.
- The server verifies the actor's **current** native Administrator role and the role positions of the actor, bot, and target immediately before writing a warning, adding a note, or deactivating a warning. No one can target themselves, the Owner, the bot, or other bot accounts. A target above the bot role is rejected.
- A warning with an optional `proxy-post` checks `pc_posts` for the original writer, both original and proxied message IDs, channel and character ID. The selected **Discord user** must match the recorded original author. The webhook or character is never treated as the responsible account.
- All records and reasons remain private to Owner/Admin. Raw source-message mappings are used only as evidence and do not grant the bot an unrestricted Discord history search.

### Moderation slash commands

- `/mod warn member:[user] reason:[optional] proxy-post:[optional message ID]` creates one durable warning per signed interaction, plus a private DM attempt.
- `/mod note member:[user] note:[private text]` records an internal note without sending it to the member.
- `/mod warnings member:[user]` counts active warnings; `/mod history member:[user]` lists recent private cases; `/mod case case:[UUID]` displays events and linked evidence.
- `/mod remove-warning case:[UUID]` deactivates a warning, preserving its original record and a separate irreversible audit event. Warnings **never expire automatically**.
- The **fifth active warning** records a **staff-review-needed event only**. No punishment is selected or carried out. Existing warnings still count, and an owner/admin can deactivate them.

### Shared scheduled jobs

- `/remind me minutes:[1–10080] message:[text]` schedules a private Discord DM for yourself. `/remind list` shows pending reminders; `/remind cancel id:[reminder ID]` cancels a queued reminder. There are at most **20 pending reminders per member**. Recurring reminders and configurable channel announcements remain for a later phase.
- Staff warning notices and personal reminders use the same additive, SQLite/PostgreSQL-backed queue. The worker claims jobs with leases, stores delivery attempts and statuses, retries transient Discord errors, and marks disabled DMs undeliverable without undoing the moderation case.
- The bot uses a stable Discord message nonce for deduplication. The job database persists across restarts, but actual DM delivery still depends on Discord permissions and availability.
- The Owner can enable or disable `moderation` and `reminders` independently through `/community-module set` or the **Community** dashboard switches, with existing revision/audit tracking. They are initially enabled; disable if a moderation team is not ready.

### Data and rollout

New tables: `pc_mod_cases`, `pc_mod_case_events`, `pc_core_jobs`; existing RP, character, economy, NPC and SupportCase data are not migrated or altered. Only the **Convergence** guild is in scope. No DISBOARD automation. Bot-Hosting.net needs a backup and restart to load this code, followed by verification that the PhoenixCore role is above targets intended for moderation and that the bot can DM members.

**Not yet covered:** punitive Discord actions, escalation settings, private staff dashboard case search, full audit-log event collection, anti-nuke, automod, sanctions with expiry, SupportCase appeals, recurring reminders, scheduled bump announcements, module-specific staff delegation and diagnostic repair screens. Those remain in the seven-handoff roadmap rather than being represented as finished.

## Unified Support Center — private case foundation

The Support Center is a **single authoritative case system**, separate from character submission approval. The first version has four kinds (`ticket`, `modmail`, `report`, `appeal`) sharing the same state, audit and staff authorization; ordinary members are not required to choose ticket categories or complete lengthy questionnaires.

### Member entry and private messaging

- `/support open`, `/support report`, `/support appeal`, `/support list`, `/support view` and `/support reply` work as ephemeral Discord interactions. Ordinary members can view/reply to their own cases only.
- A Discord DM to PhoenixCore opens a Modmail SupportCase. A leading `Appeal:` starts a case suitable for a banned ex-member who can still DM the bot. If one Modmail case is open, a follow-up DM belongs to that case. If multiple are open, the bot **refuses to guess** which case and asks for `#CASE-UUID message`.
- The website now includes an authenticated **Support Center** tab for generic ticket/report/appeal intake, private case queues, recorded conversation and authorized staff replies.
- Discord attachment links from supported Discord CDN URLs can be logged with a DM, but durable file storage, edited/deleted message sync, all file types and access expiry handling are not yet production-complete. Do not claim permanent evidence storage from an expiring link.
- Staff have `/support open-for` to start a case for someone else. Ordinary members cannot close or reopen their own cases.

### Staff authorization and case states

- Owner, native Discord Administrators and configured Helpers may handle ordinary cases. **Sensitive cases are restricted to the Owner as staff**, and cannot be assigned to ordinary Helpers. This is enforced in the service, not just by hiding controls.
- Supported states: Open, Claimed, Waiting for Member, Waiting for Staff, Resolved and Closed. Auto-assignment uses a current, eligible support roster and least-open-case choice, falling back to Owner if Discord member data is temporarily unavailable. This policy is a configurable future refinement; do not treat it as an owner-selected permanent distribution policy.
- `/support claim`, `/support transfer`, `/support resolve`, `/support close` and `/support reopen` mutate audited state. There are **no priority tiers**.
- `/support note` is **strictly internal**. `/support send` explicitly sends a queued DM as **Convergence Staff**, optionally signed by the real staff member. Typing ordinary staff-thread text cannot silently send an outward reply because no automatic staff-thread forwarder exists.
- Sensitive case details are redacted from other staff; anonymous report author identity is not exposed to ordinary Helpers. The Owner and native Discord Administrators may see reporters when authorized.
- `/support block` can restrict ordinary intake for abusive accounts, without barring appeals through the approved appeal routes.

### Idle closure, delivery and restart safety

- Four hours after the last genuine case conversation, an active case closes automatically. Staff-only internal notes or automatic status changes do not reset that inactivity clock. Closing is delayed while an explicit staff DM reply remains pending; successful delivery or final failure allows later closure.
- Private reply DMs are stored in a lease/retry queue with stable Discord nonces, delivered without accidental mass mentions. Disabled recipient DMs are recorded as undeliverable and do not roll back the staff case action.
- New additive tables: `pc_support_cases`, `pc_support_events`, `pc_support_outbox`, `pc_support_idle`, `pc_support_blocks` and a reserved `pc_support_templates` table. Existing RP, economy, moderation, character and community data remain intact.
- The Owner can toggle **support** independently from other modules using `/community-module` or the Community dashboard.

### Deliberately unfinished portions

This is the **foundation**, not the full 60-answer support specification. Private Discord ticket-channel/thread provisioning and customizable opening panels, staff-thread interaction surfaces, robust bidirectional attachment and edit/delete synchronization, owner-configured Modmail acknowledgments, support templates, staff alerts, participant invitations, analytics UI, surveys, and the reusable drag-and-drop visual editor remain future milestones. Transcript format, destination, default generation, retention, and member copies are expressly unresolved in the handoff; no retention policy was invented.

Back up the Bot-Hosting database before restarting to apply a new release. Validate staff access, Owner-only cases, ordinary member isolation, a direct DM, and the new Support Center tab against a consenting test account before broad rollout.

## Giveaways — fair draws, member entries and character-bank rewards

PhoenixCore has a new **Giveaways** site section plus the single `/giveaway` Discord slash-command group. This is the implementation foundation for the owner's November 21 GiveawayBot handoff, integrated with the existing economy and staff-role architecture.

### Setup and participation

- The **Owner** must designate one or more real Convergence text/announcement channels using `/giveaway channel-add` or the website's Owner channel settings. Staff cannot create giveaways in non-designated channels.
- The **Owner, native Discord Admins and configured Helpers** can create giveaways with an explicit duration, per-giveaway claim deadline, winner count, and Zeni or manual prize. Creation supports an optional delayed start.
- The bot posts one durable public giveaway embed in its designated Discord channel; the embedded **Enter** and **Withdraw** buttons record one entry per real Discord account. Members may also use `/giveaway join` and `/giveaway withdraw`, or the website.
- Required and excluded role IDs may be configured on the website. The engine rechecks them when drawing and claiming; no minimum account age, membership tenure or activity threshold is imposed.
- The **Owner-only participant directory** is available on each giveaway's website detail page. It lists the currently identifiable Discord username, server nickname/display name, Discord user ID, entry/withdrawal status, join timestamp, current booster qualification, and current or recorded draw-time ticket count. The view is paginated and filters entered versus withdrawn accounts. Former members retain their recorded Discord IDs; display names may be unavailable if Discord can no longer resolve them. Helpers, Admins, and Members do not receive participant identity lists from the API; public event pages still show only aggregate counts and announced winners.
- **Boosters get 3 total drawing tickets** at the time of the draw (1 normal + 2 bonus). Other members receive 1. This changes win probability only: the draw picks **distinct Discord users without replacement**, so one booster cannot win multiple winner slots.

### Drawing, claims, and audit

- Active giveaways automatically close/draw when their end time arrives. Staff can end early, pause, resume or cancel; a paused giveaway resumes with its remaining entry duration. Staff can also edit a scheduled/open giveaway's title and description or extend its entry deadline from Discord or the dashboard. These operations require the current giveaway revision (`/giveaway view` displays it), reject stale edits, and record an audit event. They cannot alter prizes or already-finalized draws. Editing or extending during a pause preserves the pause timer. The scheduler and public embed posting survive bot restarts.
- Winners have the explicitly entered claim window. **Unclaimed** positions automatically reroll after expiry, excluding **all previous winners**. If no eligible entrant remains, the slot is recorded as exhausted without manufacturing a winner.
- The system snapshots participant eligibility and booster tickets, records the random draw and timestamps, and uses cryptographically secure random selection. The Owner may identify a manual winner using a clearly **MANUAL** event instead of pretending a random result.
- **Zeni** awards are not paid at entry or drawing. At claim, the winning member selects one of their approved characters; the existing economy ledger atomically credits that character's **bank**, leaving on-hand cash and the approved character sheet unchanged. Every winner has a unique payout transaction; retrying a claim cannot double credit.
- When the giveaway ends, its public Discord message offers **Claim prize** while a claim window remains open. A winning member receives a private character-selection menu for Zeni prizes (up to Discord's 25-option component limit); the claim is verified again before the bank payout. Other members cannot claim. Manual prizes use the same button and remain pending until a staff member confirms delivery. The website and existing `/giveaway claim` remain available; no UUID needs to be copied when using the button.
- **Manual prizes** (titles, external rewards, etc.) are claimed but remain marked **pending staff delivery** until staff explicitly confirm. The engine deliberately does not pretend an inventory item, rank, or role has been automatically awarded if no authoritative integration exists.

### Commands

`/giveaway channels`, `channel-add`, `channel-remove`, `create`, `edit`, `extend`, `list`, `view`, `join`, `withdraw`, `claim`, `pause`, `resume`, `end`, `cancel`, `reroll`, `manual-winner`, and `confirm` are registered as Convergence-guild commands. Website controls expose designated channels, staff creation, entry, monitoring, Zeni claims, and essential draw actions. The Owner can independently switch the `giveaways` module on or off.

### Deliberately incomplete features

Owner-approved reusable event templates, custom embed presentations/themes, reaction-based entry, changing immutable prize/draw rules after creation, multiple physical-item/role prize integrations, interactive modal wizard, richer history/statistics screens and role-specific reward grants are **not yet finished**. Retention **defaults to seven days after completion/cancellation** and is enforced by a restart-safe cleanup worker. Source giveaway records and old public embeds are deleted only after outstanding prize claims are settled or expired; the authoritative Zeni economy ledger and giveaway reference in its transaction reason remain intact. Do not claim full GiveawayBot parity yet.

**Operational requirements:** Back up the database before pulling this additive schema. Keep channel permissions (view, send, embeds and messages) available to PhoenixCore. Test with a consenting member, a short claim window, an approved character and a small Zeni amount; verify the bank statement. No real currency or prizes should be distributed to test accounts without the Owner's agreement. No additional paid AI provider is involved.


## Shops & inventory — transactional character purchases (foundation)

PhoenixCore's **Shops & Inventory** website tab and `/shop` Discord commands now use the same character-owned economy account, without creating a shared wallet or bypassing owner-approved sheets.

- The Convergence Owner and configured Helpers can define **consumable/material** or **equipment** item definitions, create **general** and **location-restricted** shops, set per-shop item prices, stock quantities (including unlimited), allowed RP channel IDs and shop open/closed state. Every shop starts **closed** and configuration writes require its current revision; actions are audited.
- A central item definition can appear in multiple shops with independent price and stock. General shops are accessible across eligible RP channels; restricted shops require the exact configured RP channel or a thread whose parent is configured. A shop outside the character's current RP channel remains browsable, not purchasable.
- `/shop list` lists shops. `/shop view shop:<UUID>` shows an interactive catalog with item, approved-character and cash/bank payment selection. `/shop buy` supports an explicit quantity (1–100), payment account and character. The website provides shop/inventory browsing and staff catalog/stock/location configuration, **not remote purchases**.
- Each purchase checks the signed Discord guild/channel and RP eligibility, current shop status/location, character ownership, exact price and stock. One database transaction handles cash/bank debiting, optional mirrored character-sheet cash, stock decrement, inventory increment, receipt and accounting entries. Repeated interaction receipts do not charge twice.
- Inventory belongs exclusively to the approved player character and is displayed to that player or authorized staff. Items are currently tracked in **stacks**. No arbitrary initial slot cap, automatic item effects, durability, equip slots or ability grants have been silently invented. Existing character `gear` JSON is not overwritten. Player-designed items continue through the existing approval workflow; the shop-admin item command is explicitly for staff-authored definitions.
- The existing Zeni currency ID remains immutable. Bank or cash can be chosen deliberately for each purchase; no negative balance, freeze policy or default discount is assumed.

**Known unfinished portions:** shop banners/images, theme editor, dynamic player-owned merchant permissions, Codex world/location ID mapping, multiple shop-location overrides, stock auto-restocking, item effects/durability/slot expansions, item trade and gift, buyback, marketplace, in-character interactive merchant dialogue, configurable discounts, multi-currency account ledgers and full analytics. These remain separate, owner-gated follow-up milestones. Shop stock and inventory migrations are additive; back up the DB before deployment and live-test with low-value fictitious Zeni. The website intentionally does not authorize a purchase using a manually entered channel, because the actual RP interaction context must come from Discord.



## Self-assignable role panels — Owner-governed foundation

The **Role Panels** website section and `/roles` command group let Convergence members choose ordinary Discord roles via a published button or select-menu panel, without an unsafe public role-grant command.

- The Carl-bot handoff left panel-administrator authority **provisional**, so only the **configured Owner** may create, edit, publish, hide or configure role panels until the owner approves further delegation. Owners can use the dashboard or `/roles admin-*` commands. Each panel starts unpublished. The Owner-only `roles` community module switch disables interactions and refreshes public messages.
- A panel can use **up to five buttons** or **up to 25 select-menu options**. Members can hold multiple independently selected roles. Choosing an already-held role removes it. No mutually exclusive groups or timed panels have been imposed.
- Every self-service action revalidates the signed Convergence interaction, original panel message/channel, current Discord membership, current selectable-role configuration, bot role hierarchy, managed-role flags and elevated permission bits. The **Helper role cannot be self-assigned**. Protected or higher-ranked roles are always denied, including roles configured by mistake. The bot must have Discord's `Manage Roles` permission and a sufficiently high role position.
- Every action gets an idempotent Discord-interaction receipt and an audit record. A duplicate interaction ID cannot flip a role twice. Dashboard statistics show **recorded current panel selections**, not a claim of authoritative live membership after unrelated manual role changes.
- Published panels are posted or edited in place by a restart-safe worker. Owner edits and module switches refresh the canonical original Discord message; retries are supported. No new database or web app is introduced.

**Still incomplete from the approved Carl-bot scope:** reaction-based role selection, safe sticky-role leave/rejoin restoration, expanded panel presentation (images/icons), panel reordering, advanced statistics and unified role/sticky/informational panel editor. The owner did **not** definitively authorize Owner-and-Admin panel creation, so this implementation does not silently grant Admin or Helper creation rights. If the RP gateway is not running, signed Discord slash/component interactions still work through the main interaction endpoint; live role assign/remove requires the bot's Discord permissions.



## NPC-linked shopkeepers and editable shop rosters

When an Owner/Helper creates a shop, the **Shopkeeper** field in the website offers a dropdown containing **all currently approved NPCs** in Convergence's authoritative `pc_characters` registry. The dropdown also includes **Custom Entry**, which reveals a required free-text name. It never invents or submits an NPC record. The Discord `/shop admin-create` and `/shop admin-keeper` commands offer the same choice via live NPC autocomplete; Discord limits each autocomplete response to 25 entries, so players can search larger directories by name, with Custom Entry always available.

Approved NPC choices store a **stable `owner_npc_id`** plus a name snapshot. When the NPC is renamed or changes portrait, the shop displays the live approved name and portrait while retaining its identity. If that NPC is subsequently deleted, shops continue displaying the stored name snapshot rather than silently reassigning the merchant. Existing pre-migration shops retain their earlier custom shopkeeper names; new shopkeeper associations are optional at the schema level for backward compatibility, but the website and Discord creation screens require an explicit choice.

Staff can later **switch shopkeepers** from the same selector, with version checks and audit history, without deleting the shop's stock or existing customer purchases. Staff can also **unlist an item** from one shop (website or `/shop admin-unlist`) without deleting the item definition, another shop's stock, or a character's purchased inventory; restocking the same item later is supported. Owner/Helpers have the same existing shop management authorization, with no increased privilege scope. NPC merchant selection does not yet authorize automatic NPC dialogue or ownership transfers.

The change adds a nullable column to the existing shop table using an idempotent SQLite/PostgreSQL migration. Back up your live database before rolling forward, and verify the populated NPC dropdown using your currently approved NPC registry rather than a hard-coded demo roster.



## Shop sales reports — Owner/Helper only

The Shops & Inventory dashboard now includes read-only **all-time, last-seven-day and last-30-day** sales summaries. Owner and configured Helpers can review purchases per merchant, including total units, unique purchase receipts, cash-vs-bank Zeni spent, top purchased items, and up to 40 recent receipts. Members never receive financial reports, even though the shop catalog remains browsable. Staff can also run `/shop admin-sales` with or without a shop ID; the command replies privately.

Sales data comes from the existing authoritative `pc_shop_purchases` receipts, not from an editable sheet or a new shop wallet. Zeni totals are aggregated with JavaScript `BigInt` and returned as integer strings to preserve exactness above Number.MAX_SAFE_INTEGER. The report pages through existing receipts by timestamp and receipt ID, avoiding a hard-coded 100- or 1,000-sale cap, and can still include items that have since been unlisted. The reporting endpoint is `GET /api/economy/shops/sales` and is subject to the same authenticated Owner/Helper permissions as shop management.

A sale reflects **actual PhoenixCore checkout**, not arbitrary Discord messages, unpaid cart attempts, manually edited inventories, or in-character dialogue. Reporting is historical and read-only; it does not alter accounts, stock, refunds, transfers, or prize logic. As a scalability follow-up, servers with unusually large receipt volumes may want a durable pre-aggregated sales index, but the baseline has no additional reporting migrations or denormalized balances.

