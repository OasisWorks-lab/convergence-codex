# Convergence Codex V3 — Lightweight public edition

This is the **public** website. It contains no editing interface and requires no server-side software.

## Upload to GitHub Pages

1. Create or use the `convergence-codex` GitHub repository.
2. Upload the **contents** of this `Convergence_Codex` folder (the `index.html`, the subdirectories, and `assets/`) to its root. The package has **fewer than 100 files** in total.
3. In GitHub, visit Settings → Pages, choose Deploy from a branch, `main`, `/ (root)`, then Save.
4. Copy the link GitHub gives you into the Discord server.

`assets/data.js` stores all publicly visible lore, mechanics, and transformations. Its content remains based on the old server exports and is not an approved rules redesign.

All individual form illustrations were replaced with the same original Convergence phoenix logo; each world keeps its illustrative landscape. This reduces the file count dramatically.

## Editing and security

A **separate owner-only local editing kit** is available. The public site has no admin page. In the kit, open `admin.html`, edit entries, download an updated `data.js`, and upload that one file to `assets/data.js` on GitHub. Only accounts with write access to the repository can commit changes. This workflow does not require storing passwords, tokens, or secrets in the website.

GitHub Pages itself cannot authenticate users or write to the repository without a secure backend. Do not add client-side password gates or publish a GitHub token in your site.
