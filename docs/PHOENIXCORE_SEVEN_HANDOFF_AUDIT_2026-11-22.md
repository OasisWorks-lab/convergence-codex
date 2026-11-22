# PhoenixCore — seven-handoff source and implementation audit
**Audited:** 2026-11-22. **Scope:** Convergence: Phoenix Rising only. **Repo:** `OasisWorks-lab/convergence-codex` on `main` (after PR #21).
**Sources:** Owner-approved Dyno (63 decisions), Carl-bot (40), GiveawayBot (44 plus 4 follow-up decisions), PluralKit (40), Unified Support Center / Ticket Tool / Modmail / drag-and-drop (60), UnbelievaBoat economy (65), Wheel of Names (56). Original owner documents dated 2026-11-21 remain authoritative; this report is a progress audit, not a replacement specification.

## Hard invariants
- **Single guild** only. Never modify, substitute for, or automate interactions with **DISBOARD**.
- One canonical character registry and RP proxy attribution. Preserve `pc_posts`, original human identity, character ID, NPC memory, individual character turns, pending reviews and economy ledger.
- Scope-bound roles and staff checks must be enforced in service handlers, not only on the dashboard.
- Prefer additive SQLite/PostgreSQL migrations, idempotent jobs and real Discord permissions. Never invent unapproved economy outcomes, ban sanctions, inaccessible data or extra game progression systems.
- All feature modules must be independently toggleable, and private information must remain protected.

## Requirement × existing source audit

| Handoff | Currently implemented or partly implemented | Significant work still required | Unapproved or tentative choices that block only their affected features |
| --- | --- | --- | --- |
| **Dyno** | Owner identity; existing Helper review authorization and recorded settings history; configurable welcome/guidelines embeds; basic review notifications; Discord gateway RP scope. | Central Owner/Admin/Helper/Member authorization and protected-role matrix; complete moderation cases, warns, actions, anti-nuke, opt-in automod and honeypot; durable jobs, scheduling, welcome/verification/autoroles, custom commands, polls, AFK, utility reminders, diagnostics, staff logging and exports. | Fifth-warning **punishment** not selected; trap exclusions not decided; music audio-source rights/queue unspecified; appeal workflows to reconcile with Support Center. |
| **Carl-bot** | Owner-published fixed welcome/guidelines embeds; existing character proxy tags are **not** informational tags. | Separate informational tags/proposals/versioning, suggestions/votes/staff decisions, self-role panels and safe sticky-role restore, more panel editors and RP-excluded stickies, optional source-approved feeds and webhook integrations. | Role panel authoring Owner-only vs Owner+Admin unresolved; temporary self-service/staff roles tentative. Do not create XP, rep, starboard, generic keyword autoresponders. |
| **GiveawayBot** | Character-owned bank ledger exists, but no authoritative giveaway draw. | Designated giveaway channels; durable creation/entry/draw/claim/reroll; member identity instead of character at entry; booster **3 total tickets** at draw; unique winners; selected eligible character **at claim**; bank payout through existing ledger; templates, panel and seven-day default retention. | Claim period configurable, no universal duration approved; character-only prizes without a character, reroll backoff, aggregate retention remain open. |
| **PluralKit-inspired** | Multiple OC slots from one Discord writer in one NPC scene; verified tag/character proxy, favorites, basic directory and cards, separate NPC directory. | Optional pronouns/birthday/banner/accent/custom fields routed through approvals; scene timelines/presence, structured bilateral relationships, optional groups and directory filters; verified dual-account linking, narrowly scoped fusion co-control, proxy message tools/diagnostics, staged imports/exports. | Fusion canonical owner and turn completion, TTS, public profile links and AI fusion artwork remain unapproved or tentative. Older **5-context default and immediate pings** were intentionally superseded by recent owner tests: fresh scene context **0** and one 30-minute reminder. |
| **Ticket Tool + Modmail** | Review/denial request workflow is **not** a generic SupportCase. Owner settings exist but no unified Support Center. | Unified SupportCase, private case containers, DM relay with **explicit** outward replies, staff claims/transfer, notes, 4-hour inactivity jobs, sensitive owner-only cases, linked moderation evidence and appeals, case search and drag/drop safe visual editor. | No priority tiers; members **cannot self-close/reopen** (supersedes Dyno); transcript format/retention/destination unselected; case assignment algorithm can remain configurable. |
| **UnbelievaBoat economy** | Authoritative character accounts, cash+bank balances, starting Low 1000/Middle 2000/High 4000/Noble 8000, bank deposits/withdrawals, private statements and ledger. | Authoritative items/inventory, giving money/trading, occupation directory and capacity, activity-only salary accrual, quests/tournaments, one General Store with channel/Codex location mapping, shops and stock, durable reward integration, economy role permissions and reports. | Negative balance target and unfreeze unresolved, ~100 jobs/salaries not supplied, interest rate/cadence and RP reward formula unknown, inventory capacity and tournaments adjudication unknown. |
| **Wheel of Names** | No saved wheel/draw engine. Existing economy ledger can supply future idempotent rewards. | Owner-only wheel definitions/validated imports, verifiable committed weighted drawing, public animation tied to persisted outcome, configured channels/shop entitlement, 7-day spin history and giveaway-owned visualization. | Spin entitlement unit/payer unapproved; default cooldown/refund rules unknown. Must not create ad hoc wheel draw, native OC/NPC/world wheel types, or secondary giveaway authority. |

## Dependency and ownership resolution
1. **Core permissions/config/audit/jobs** are shared infrastructure. Native Discord hierarchy and original human identity must be checked when actions take effect. Current `actorFor` grants only Owner and a configured Helper/Judge role; it is **not** a complete moderation/Admin matrix.
2. **SupportCase** owns tickets, Modmail, reports and appeals. Dyno's proposed generic priorities are explicitly **overridden by no priority tiers**. The four-hour idle closure is explicit; member self-close is rejected.
3. **Giveaway** owns draw eligibility, booster weighting, rerolls, claim and reward. **Wheel** is optionally a pre-committed animation, never a second draw or participant-paid spin when it merely visualizes a giveaway.
4. **Economy** owns currency and inventory mutation; every prize must use idempotent transactions. No extra currency wallets in other modules.
5. **Character proxy** tags and **Carl informational tags** remain separate namespaces and permission systems.
6. **Roleplay** identity is keyed by character for turns and memory, and Discord account for notifications/permissions, without merging or duplicating their identities.
7. **Drag-and-drop layout tooling** is a reusable presentation tool, not unrestricted scripting. No arbitrary code execution.
8. **DISBOARD** stays untouched; human bump reminders may be scheduled later.

## Prioritization and first independently useful milestone
**Selected:** Carl-bot's informational tags and suggestion workflows, with a shared toggles/permissions pattern. They do **not** depend on the unanswered wheel pricing, negative-balance semantics, ban escalations, fusion ownership or private transcript rules.

Acceptance for milestone:
- Reusable informational `/tag` replies and search are independent of character posting tags.
- Owner/Admin/Helper may author; ordinary members may propose for staff review but may not publish.
- Slug+alias naming, immutable revision history and rollback; replies sanitize mass mentions.
- `/suggest` stores durable member suggestions, supports one counted up/down vote per member, staff status transitions and private identity for anonymous proposals.
- Suggestions cannot auto-approve game content or grant authority. Permission checks occur in Discord handlers and dashboard endpoints.
- Independent module on/off switches without deleting records, single-server checks, SQLite and PostgreSQL coverage.

**Not claimed completed by this milestone:** full Dyno moderation, Role Panels, Support Center, Giveaway draws, Wheel engine, Economy shops or fusion authorizations. Later iterations must continue those strands according to their approved requirements.

## Implementation order after this milestone
1. Durable shared schedule/jobs + granular staff permission matrix and module configuration audit.
2. Moderation case/notes/warns with safe, owner-configured escalation (do not invent default punishment).
3. Unified SupportCase ticket/Modmail/report/appeal schema and secure staff surface.
4. Profile enrichment/approved custom fields and relationships; proxy diagnostics.
5. Giveaway draw/claim lifecycle and economy integration with the approved 3-ticket booster exception.
6. Economy shops/item definitions, RP location mapping, inventory ledger, transfers and occupation roster.
7. Saved wheel definitions/entitlements and committed randomness, animation; never introduce an unapproved purchase unit.
8. Onboarding, self-role panels, scheduling, polls, AFK, tags/visual editors, and lower-priority feeds/music only when lawful sources are selected.
