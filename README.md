# Convergence Codex · Interactive Prototype V2

A static, mobile-responsive Codex built from the previously supplied Convergence Discord documentation. No build step, database, Nitro subscription, bot token, or external hosting is required for local testing. This is still a **draft**: historical mechanics remain unchanged and many form images are illustrative stand-ins.

## Run locally

1. Extract the ZIP without moving or deleting any subfolders.
2. Open `Convergence_Codex/index.html` in Chrome, Edge, Firefox, or another modern browser.
3. Select **Races & Forms** to see Universal Paths first, then racial families. Select a race, inspect Basic Information, and open cards in **Foundational forms**, **Racial transformation paths**, and **SPARKING! transformations**.
4. Select **Worlds** to open planet/realm lore cards.

## What's new in V2

- Site theme based on the supplied Convergence: Phoenix Rising phoenix logo, including ember orange, molten gold, magenta-violet, and a dark background. The unmodified owner-supplied logo is included at `assets/brand.png`.
- Universal Paths at the start of Races & Forms; each has its own separate `.html` page, a transparent Basic Path Information panel, and clickable form/technique cards. The generic Miscellaneous archive is an assortment rather than one progression chain.
- Foundational racial forms displayed immediately after Basic Information in up to **four cards per row** on desktops; fewer per row on phones.
- Normal racial paths remain in **separate columns** below foundational forms.
- Source-identifiable **SPARKING!** paths have their own dedicated section below the normal paths with documented bonus snippets and a horizontal card grid. The classifications come from original racial descriptions. Incomplete Glind role labels and the Namekian Precursor/Berserker naming mismatch are explicitly noted rather than silently resolved.
- Redundant headings in detail panels are collapsed when the source post heading matches the exported message heading.
- Guidelines and Creation Templates are **not bundled into the public website source**. They remain in the Discord server as requested; the Systems area contains only the four core-system documents.

## Publish as a clickable Discord link using GitHub Pages

1. Sign in to [GitHub](https://github.com/) and create a **public** repository, for example `convergence-codex`.
2. Upload the **contents of `Convergence_Codex/`**, rather than the ZIP itself or the surrounding folder. Your repo's top level must include `index.html`, `races.html`, `worlds.html`, `assets/`, `races/`, `universal/`, and `.nojekyll`.
3. Open repository **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**. Set branch to `main` and source folder to `/ (root)`, then **Save**.
5. GitHub will show the site's published URL once deployment completes. The normal project-site URL is `https://YOUR-USERNAME.github.io/convergence-codex/` (use your actual GitHub username and repository name).
6. Copy the URL and place it in Discord. Members on PC and mobile can use that one stable link, and internal links work without manually creating separate websites for each HTML file.

**Privacy / copyright note:** GitHub Pages from a public repo makes your site files and embedded source material visible to others. This package deliberately excludes Guidelines and Creation Templates, but it still contains original lore and RPG rules copied from your Discord exports. Confirm the content is intended to be public before publishing. Do not upload tokens, private server exports, or passwords.

**Hosting limits:** GitHub Pages hosts static HTML/CSS/JavaScript. Phoenix Core's live user accounts, purchases, and character persistence would require a separate backend/service with secure authentication later; these are **not implemented**.

GitHub documentation: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

## Content and image limitations

- This prototype is a presentation of existing information, not a replacement ruleset. Source contradictions documented in the audit remain unresolved.
- Many form cards use local, abstract SVG artwork generated for the original prototype. **These are not the actual character transformation images.** Images can later be replaced with owner-provided art.
- The source messages for the Glind branch pages were image attachments without bundled image content; no descriptive mechanics were invented for them.
- SPARKING! identification was made only when supported by source documentation; Glind has a written SPARKING! rule but no confidently mapped path due deleted roles.
- The Universal Paths lack separate authored introductory lore posts in the export; their Basic Path Information panel is an explicit archive overview, not fabricated lore.
