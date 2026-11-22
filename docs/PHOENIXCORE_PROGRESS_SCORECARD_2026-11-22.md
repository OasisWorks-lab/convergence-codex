# PhoenixCore implementation scorecard — November 22, 2026

**Repository:** OasisWorks-lab/convergence-codex · **Server:** Convergence: Phoenix Rising only.

## Headline

**Estimated completion of the full owner-approved PhoenixCore roadmap: approximately 25%.**

This figure is a **planning estimate, not an automated count** of 372 answers or an assertion that the AI has tested every live Discord workflow. The seven 2026-11-21 owner handoffs are requirements inventories, some entries being decisions rather than buildable features. The estimate is deliberately conservative and weights whole systems, integration, safety, dashboard controls and operations—not just command availability.

| Workstream | Weight | Estimated completeness | Weighted points | What is actually present / still lacking |
| --- | ---: | ---: | ---: | --- |
| Hosting, bot runtime, database, testing, dashboard, authentication | 12% | 60% | 7.2 | GitHub CI/Pages, Bot-Hosting pull on restart, SQLite/Postgres, account login and core dashboard. Production deployments are not automatic unattended pushes; live verification after restart remains necessary |
| Roleplay, characters, NPCs, dynamic scenes | 18% | 45% | 8.1 | Playable characters, forms, proxy identities, turn scenes, persistent/test NPC memory, free AI failover, response-depth profiles. Full progression, multi-anime world systems, profile expansions, long-run AI quality and RP UX remain incomplete |
| Carl-bot community features | 10% | 35% | 3.5 | Informational tags/proposals/versioning, anonymous suggestions/votes/staff decisions, dedicated channel, website removal. Self-roles, sticky roles, rich panel editors and integrations remain |
| Dyno moderation, operations and utility features | 16% | 12% | 1.9 | Staff identity rules, private warning/note foundation, fifth-warning **review only**, cancellable one-time DM reminders and restart-safe jobs (PR #25). Discord sanctions, automod, anti-nuke, scheduling, onboarding, polls, media, diagnostics and custom commands remain |
| PluralKit-inspired characters and connections | 10% | 15% | 1.5 | Multiple character slots, proxy signatures, character-facing directory; groups, verified cross-account linkage, relationships, profiles and fusion co-control remain |
| UnbelievaBoat economy and shops | 12% | 20% | 2.4 | Character cash/bank/ledger and starting Zeni. Inventory, jobs, salaries, trade, quests, shops, item stock and prizes remain |
| GiveawayBot | 8% | 0% | 0.0 | Draw, booster weights, claim-to-character bank deposits, rerolls and retention not implemented |
| Unified Support Center (Ticket Tool, Modmail, appeals, visual forms) | 9% | 0% | 0.0 | A character approval queue exists, but it is **not** a general SupportCase, ticket/Modmail/appeal system |
| Wheel of Names | 5% | 0% | 0.0 | Saved/weighted wheels, commitments, entitlements, animation and history not implemented |
| **Total** | **100%** | | **24.6 ≈ 25%** | |

These estimates include the moderation foundation proposed in PR #25; it counts as delivered **only after** GitHub checks pass, PR merges and the bot is restarted, then should be marked **live-verified** after owner testing. Do not treat a passed automated test as identical to successful production behavior.

## Implemented ≠ live verified ≠ feature complete

- **Implemented/merged:** the PR #24 dynamic NPC response-depth engine, latest free AI fallback and canonical NPC memories, previously merged community features, bank/cash ledger and RP/character foundations.
- **In review:** PR #25 moderation case/notice/reminder foundation, with a separate scoped GitHub review and CI gate. Until merge, its code is **not in the live bot**.
- **Live verified:** current RP scenes, core characters, suggestions and voting, economy cash/bank and dashboard features had owner feedback as working in Nov 22 tests. Model output quality and the next deployment need their own live checks.
- **Missing or undecided:** the major domains above; unresolved owner decisions are deliberately excluded from completed feature claims.

## Next major milestones after PR #25

1. Extend moderation with safe, opt-in staff permission matrix, audit diagnostics, scheduled action expiry and native Discord enforcement **only with confirmed settings and hierarchy checks**; never guess a fifth-warning punishment or trap exemptions.
2. Build the unified private SupportCase domain for tickets, Modmail, reports and appeals, respecting the approved no-priority and no-member-self-close rules, plus four-hour inactivity scheduling when configured.
3. Build authoritative giveaway entry/weighted draw/claim and route all Zeni to the existing economy ledger, observing booster three-total-ticket rule and character selection at claim.
4. Expand canonical character profile fields/relationships and economy shop/item/inventory without creating parallel identity or currency stores.
5. Saved wheels and purchase entitlements only after remaining owner-defined payment/cooldown rules are finalized. Giveaways own their draw even if a wheel animates results.
6. Complete modular onboarding, panels, self-roles, polls, diagnostics, maintenance tools and dashboard UX in small verified slices.

## Safety and invariant checks

- One guild only; no second Discord server, DISBOARD replacement, unsolicited mass pings, new member XP, reputation or starboard.
- No hidden paid AI fallback.
- Full account identity and source-post attribution for moderation; do not punish proxies/webhooks.
- Owner/Admin moderate; Helpers have feature-specific review/support roles only.
- No guessed five-warning sanction, overdraft policy, fusion ownership, wheel charge or private transcript retention.
- Maintain SQLite and PostgreSQL tests and live hosting restart verification at every milestone.

**Definition of 100%:** All approved requirements implemented or explicitly ruled out by the owner, integrated across Discord and website, authorization and reliability tested, and major workflows owner-validated in a live environment. A working bot pilot is not the same as the full vision.
