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

Guided dialogue runs on the bot host. NPCs treat unfamiliar OCs as strangers unless the approved NPC biography, family relationships, or in-world scene interactions establish otherwise. No response should assume the NPC heard a name only because Discord labeled the author with it. For optional open-ended dialogue, the owner sets `PHOENIX_NPC_OPENAI_KEY`, an enabled Responses API model in `PHOENIX_NPC_AI_MODEL`, and a positive daily reply cap in `PHOENIX_NPC_AI_DAILY_REPLIES`, then restarts. Choosing **AI dialogue** shares the selected opening history, recent scene exchanges, the current writers’ posts and the NPC brief with OpenAI. Guided dialogue uses local scene cues and authored responses. The default is guided. The daily cap counts attempted AI replies across the server. At the cap or during a provider outage, the scene continues with guided replies.
