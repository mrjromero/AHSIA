# AHSIA Constitution Review

Static GitHub Pages front end for the AHSIA 2026 Constitution review, with voting and comments stored in Google Sheets through a Google Apps Script web app.

## Repository files

- `index.html` — Constitution review application and voting UI.
- `Code.gs` — Google Apps Script backend source.
- `.nojekyll` — Ensures GitHub Pages serves the repository as plain static content.
- `.github/workflows/pages.yml` — GitHub Pages deployment workflow.

## Google Sheets / Apps Script backend

A Google Sheet named **AHSIA Constitution Review Responses** has already been created in the project owner's Google Workspace with a `Responses` worksheet using these columns:

`SubmittedAt`, `UpdatedAt`, `ResponseId`, `VerifyHash`, `ArticleNumber`, `ArticleRoman`, `ArticleTitle`, `Name`, `Institution`, `Role`, `Vote`, `Comment`, `Language`, `PageUrl`.

To activate voting:

1. Open the response Google Sheet.
2. Choose **Extensions → Apps Script**.
3. Replace the default script with `Code.gs` from this repository.
4. Save, select `setup`, and run it once. Authorize the requested Google Sheets access. This stores the bound spreadsheet ID in Apps Script properties and verifies the `Responses` schema.
5. Choose **Deploy → New deployment → Web app**.
6. Execute as the deploying account and grant access broadly enough for the intended reviewers. For a public consultation this generally requires an access option that permits unauthenticated visitors; Google Workspace policy may restrict that option.
7. Copy the deployed URL ending in `/exec`.
8. In `index.html`, replace the `APPS_SCRIPT_URL` placeholder with that `/exec` URL and commit the change.

Test the backend before voting:

```text
YOUR_EXEC_URL?action=health
```

A successful deployment returns JSON with `"ok": true`.

## GitHub Pages

The repository contains a GitHub Actions workflow based on GitHub's official static Pages starter workflow. If Pages is not already enabled, open **Settings → Pages**, choose **GitHub Actions** as the source, and then re-run the workflow or push a commit to `main`.

The application uses hash routes such as `#/article/1`, so it works at the project-site path without server-side rewrite rules.

## Privacy and voting integrity

`PUBLIC_RESULTS` is currently `true` in `Code.gs` so the app can display the shared results dashboard and comments. This means submitted names, institutions, roles, votes, and comments are available through the public read endpoint. Set it to `false` and remove/redesign the public results UI if responses must remain confidential.

This is a consultation-response system, not an authenticated election system. Browser local storage identifies a participant's existing response for editing, but it does not enforce one-person-one-vote across devices, browsers, or cleared storage. Use authenticated identity or server-issued voter credentials if strict election integrity is required.
