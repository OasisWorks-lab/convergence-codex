# PhoenixCore — implementation roadmap

**Target:** Convergence: Phoenix Rising only  
**Repository:** `OasisWorks-lab/convergence-codex`  
**Source of authority:** Owner-approved November 21, 2026 module handoffs and live source in `phoenixcore-service/`.  
**Status:** Engineering roadmap. This is not evidence that unimplemented features are deployed.

## Rules that must survive every phase

- **Single guild.** Do not add PhantomPhoenix Official Hub or generic multi-guild operation. Do not replace, alter, or impersonate DISBOARD. Use Discord's native Events instead of reproducing the event scheduler.
- **Identity.** A player's Discord snowflake is stable; their username is not. Character identities, stats, wallet, bank, gear, progression, and active forms belong to the approved character, never a shared player wallet. Fusions receive only their specifically authorized shared controls.
- **Authority.** Owner alone saves global settings and makes final sheet/award approvals. Helpers can judge training and handle delegated workflows. Admin and Helper permissions are scoped by feature; always verify Discord permissions and role hierarchy server-side. A Discord message button or hidden web control does not itself authorize a write.
- **One source of truth.** Extend existing PhoenixCore character records, posting attribution, approval transactions, and database. Do not add competing character, currency, case, permission, or scheduler systems.
- **Correct posting attribution.** Character proxy messages still belong to the real member. Moderation, training evidence, and scene participation must use the verified source author and selected character identity.
- **Conservative migrations.** Existing approved sheets and settings must survive restarts, upgrades, rollback, and partial deployment. Idempotent credits/claims, transaction logs, stale-request protection, and database backups are mandatory for durable actions.
- **Owner decisions.** A tentative answer (`maybe`, `I guess`, `meh`, `not sure`) is not a hard requirement or permission to invent a final rule. Reserve open decisions and disabled-by-default settings rather than silently choosing.

## Established source baseline

The checked-in bot already contains Discord OAuth and a character directory, owner review, Helper judgment, request notifications, individual character sheets, post tags/defaults, native Discord submission intake, forms/transforms, and NPC scene infrastructure. The website and dashboard share this repository while the Node backend runs separately. Some interface paths provide practice data; test every claim against the deployed service before calling it live.

The character-based scene slots implementation is proposed independently in [PR #14](https://github.com/OasisWorks-lab/convergence-codex/pull/14). It is **not** included in this roadmap branch and must not be treated as merged until the PR actually is.

## Delivery sequence

| Phase | Scope | Acceptance gate |
| --- | --- | --- |
| 0 | Runtime/regression audit, deployment/readiness verification, backup and restore exercise | Command registry matches Discord; no character loss; CI and current live gateway checked separately |
| 1 | Shared permissions, scheduler, audit log, module toggles and dashboard configuration architecture | Owner settings protected; delegated privileges enforced by server and Discord hierarchy; jobs survive restarts and retries |
| 2 | Economy ledger, bank/cash accounts, societal class, currencies and reward plumbing | No cross-character balance leakage, no double-credit on retries; freeze behavior only after open rules resolved |
| 3 | Role panels, persistent/sticky roles, informational tags, suggestions and configurable embeds | One shared panel model; channel permission checks; no conflicting Carl-bot/Dyno duplicates |
| 4 | Moderation, automod, anti-nuke, appeals and protected staff operations | Verified author of proxy posts, dry run, owner immunity for automod, logged reversible actions and trusted audit evidence |
| 5 | Unified SupportCase system for tickets, Modmail, reports and sensitive appeals | One ticket category, generic question intake, Owner-only sensitive case route, staff assignment and transcript controls |
| 6 | Giveaways, reward claims, Wheel of Names and controlled prize transactions | Draw auditable independently of animation; user-level giveaway entries; character selected at claim; no duplicate award |
| 7 | PluralKit/Tupperbox extensions, scene timelines, advanced character profiles, imports, relationships and roleplay UX | Existing proxy and scene systems preserved; required ownership/relationship approvals enforced |
| 8 | End-to-end accessibility, mobile dashboard, import/export, load tests, backup recovery and production rollout | Production readiness checklist, smoke test on real Discord channels, safe rollback |

Phases can be split into independently reviewed pull requests; they are a dependency order, not a mandate to enable everything at once.

## Module-specific decisions

### Economy (UnbelievaBoat-equivalent)

- Default currency: **Zeni**, with immutable currency IDs and configurable display names. Multi-currency compatible, not necessarily multiple launch currencies.
- Approved starting funds by **societal** class: Low **1,000**, Middle **2,000**, High **4,000**, Noble **8,000**. This is separate from a character's power/race class. Grant once on character approval, never per sheet update.
- Character-owned **cash and bank**; permit deposit, withdrawal, giving, and configurable interest. A character's money is never automatically transferable to that same player's sibling OC.
- The owner approved negative balances and thresholds (Low -1, Middle -100, High -1,000, Noble -10,000) but **has not decided** whether thresholds apply to cash, bank or totals and how unfreezing works. Do not finalize a freeze algorithm yet.
- Passive activity earnings derive from **valid PhoenixCore-proxied RP**, not ordinary chat farming. Daily/weekly and occupation payouts require configuration. Plan roughly 100 occupations; the actual catalogue and salaries remain open.
- Quest and tournament prizes use the shared transaction ledger. Tournament winner payment defaults to 10,000,000 Zeni, subject to qualifying rules not yet finalized.

### Moderation and community management (Dyno/Carl-bot-equivalent)

- Moderators: Owner/Admin; Helper isn't automatically a full moderator.
- Support warnings, timeouts, kick/ban/softban/unban, purge, channel lock, slowmode, private staff notes, appeals, timed sanctions and complete staff history.
- **Five active warnings** trigger escalation, but the exact punishment and repeat behavior are **unresolved**. Do not automatically ban or time out based on a guess.
- Invitation/suspicious-link rules, anti-spam, phishing, optional honeypot, and anti-nuke must honor explicit channel/role configuration, dry-run and server permissions. Owner is protected from automod. No join-spike ban policy or age gate.
- Carl-bot features: role buttons/selects/**reaction roles**, sticky roles, reusable informational tags, suggestions, persistent editable panels, and sticky messages **outside RP channels**. No separate XP/reputation/starboard or generalized scripting engine.
- Custom commands are Owner-authored; informational tags can be authored by Owner/Admin/Helper and have staff-reviewed member suggestions.

### Support center (Ticket Tool + Modmail)

- One `SupportCase` record for general ticket, DM Modmail, appeal, and report. Shared history, audit, assignment, notification and dashboard controls; no duplicate ticket service.
- Member states a question/problem directly. No mandatory categories, questionnaires, priority levels or per-member ticket cap.
- Entry from slash commands, interactive panels and dashboard. Use **one category** for ticket channels; private threads are supported where Discord allows. Multiple customizable panels are fine.
- Owner/Admin/Helper may handle normal cases; sensitive staff complaints and selected appeals are Owner-only. Auto-assignment is approved but its balancing algorithm remains open.
- A drag-and-drop dashboard is a **visual layout/configuration editor**, not an unrestricted scripting engine. Maintain explicit permissions and allowed widget/actions.

### Giveaways

- Owner/Admin/Helper can manage. Restrict to designated channels. Scheduled start, pause/resume, editable entries and end times, templates, rich presentation and automatic claim-deadline rerolls.
- Draw entrants are **Discord accounts**, not characters. Booster gives **two extra entries**, total three tickets; everyone else one. Validate role/member eligibility at draw time.
- No person should win multiple distinct prizes in one giveaway. Mark manual Owner selections as manual, not random.
- Character-specific currency or items go to the winning member's **selected approved character at claim time**, currency into that character's **bank**. Reward writes go through the authoritative transaction ledger.
- Rerolls exclude previous winners. Retain fairness evidence and participant history as specified.

### Wheel of Names

- Wheel definitions are **Owner-only** to create/manage, guild-wide, with spin access in designated channels via a **special PhoenixCore shop**. The purchase unit is **unresolved**; do not hard-code a per-spin/bundle/permanent model.
- Support weighted probability, imports/exports (CSV, text, JSON, and platform-compatible exports), configurable animated visuals and multi-winner modes.
- Select and commit the random result before rendering animation; any manual override must be clearly marked. Avoid directly executing prizes from arbitrary imported wheel text.
- General wheel history is retained for **seven days**, while financial records use their own retention rules.

### Character proxy and scene enhancements (PluralKit/Tupperbox)

- Keep approved-character tags, channel/thread defaults, portraits, webhook attribution and original writer lookup.
- Character-based turns: one Discord user may play multiple OCs and each OC has its own turn; pings still target the true Discord writer.
- Optional pronouns, birthdays, banners, accent colors, custom fields, favorites, directory filtering and sorting, scene timelines and presence.
- Relationships with someone else's OC require that owner's consent. Alternate-account linking requires proof of both accounts and staff approval. Fusion collaborators have explicit revocable permissions, not generic co-ownership.
- Import/export must use existing approval, identity deduplication and safe-merge rules; no imported records bypass owner reviews.

## Reference handoffs

The requirements documents provided by the owner on November 21, 2026 are:

- `PhoenixCore_Dyno_Approved_Requirements_2026-11-21(1).md`
- `PhoenixCore_CarlBot_Requirements_2026-11-21(1).md`
- `PhoenixCore_UnbelievaBoat_Economy_Owner_Decisions_2026-11-21(1).md`
- `PhoenixCore_GiveawayBot_Finalized_Requirements_2026-11-21(1).md`
- `PhoenixCore_Wheel_of_Names_Approved_Requirements_2026-11-21(1).md`
- `PhoenixCore_PluralKit_Approved_Requirements_2026-11-21(1).md`
- `PhoenixCore_TicketTool_Modmail_DragDrop_Requirements_2026-11-21(1).md`

Those source handoffs are not duplicated into this public repository by this change. Consult their full matrices before authoring a module; this roadmap intentionally records only the high-priority constraints and dependencies.
