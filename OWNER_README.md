# Convergence Codex — Local Owner Content Studio

This folder has the normal website **plus** an offline content editor (`admin.html`).

## Edit your Codex

1. Extract this folder locally.
2. Open `admin.html` in Chrome, Edge, or Firefox. If your browser restricts file-based scripts, serve the folder locally (e.g. `python -m http.server 8000`) and open `http://localhost:8000/admin.html`.
3. Choose an entry type, then the desired world / race / form / chapter.
4. Edit title, summary (where supported), and the formatted content in the editor.
5. Click **Save entry**. Repeat for as many entries as needed.
6. Click **Export updated data.js**. The browser will download `data.js`.
7. In the **public GitHub repository**, replace `assets/data.js` with the downloaded file and commit the change. GitHub Pages automatically redeploys.

## What only you can do

Your GitHub account, **not a password embedded in HTML**, controls who can publish to the live website. Even if somebody copied the editor, they could not modify your public site without GitHub write permission. **Keep this owner kit local** and upload only the separate public edition.

## Limitations

- The editor changes content data, not the CSS, layout, or website's HTML templates.
- The editor saves in memory during a session, not to the local original data.js file. **Export before closing/reloading.**
- If you already uploaded the Codex to GitHub, only upload the newly exported `assets/data.js` file after an edit.
- Safely back up the older `data.js` before replacing it.
- This is not live browser-to-GitHub editing; building that safely would require GitHub OAuth and a secure authentication backend.
