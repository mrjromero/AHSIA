# AHSIA Constitution Review — GitHub Pages + Google Sheets

This package converts the original single-file app into a static GitHub Pages site with a Google Apps Script voting backend.

## Files

- `index.html` — GitHub Pages front end. The constitution content and multilingual UI remain in one file.
- `Code.gs` — Google Apps Script web app that writes/updates responses in a Google Sheet and serves the shared results feed.
- `.nojekyll` — tells GitHub Pages to serve the files as plain static assets.

## 1. Create the Google Sheet backend

1. Create a new Google Sheet for the consultation results.
2. In the Sheet, open **Extensions → Apps Script**.
3. Replace the default script with the contents of `Code.gs`.
4. Save the project.
5. From the function selector, choose `setup` and click **Run** once. Approve the requested Google Sheets permission. This stores the target spreadsheet ID in Apps Script properties and creates a `Responses` sheet with the expected columns.

Do not manually rename or reorder the response columns after setup unless you also update `Code.gs`.

## 2. Deploy Apps Script as a web app

1. In Apps Script, choose **Deploy → New deployment**.
2. Select **Web app**.
3. Set the app to execute as the deploying account (the account that owns/has write access to the response Sheet).
4. Grant access broadly enough for the people who will use the GitHub Pages site. For a publicly accessible consultation site, that normally means the deployment must allow unauthenticated visitors; your Google Workspace administrator may restrict this option.
5. Deploy and copy the URL ending in `/exec`.

Test the deployment in a browser:

`YOUR_EXEC_URL?action=health`

You should receive JSON containing `"ok":true`.

## 3. Connect `index.html`

Open `index.html` and find:

```js
var APPS_SCRIPT_URL = "https://script.google.com/macros/s/REPLACE_WITH_YOUR_DEPLOYMENT_ID/exec";
```

Replace the placeholder with the deployed `/exec` URL from Apps Script.

Do **not** put passwords, API keys, or private credentials in `index.html`. Anything committed to a GitHub Pages repository is client-side code and should be treated as public. The Apps Script deployment URL itself is an endpoint, not a secret.

## 4. Publish on GitHub Pages

1. Create a GitHub repository.
2. Put `index.html` and `.nojekyll` in the repository root. (`Code.gs` can remain in the repo as deployment source/documentation, or you can keep it private elsewhere.)
3. Commit and push the files.
4. In the repository, open **Settings → Pages** and select your desired publishing source/branch, or use your organization’s existing GitHub Pages workflow.
5. Open the generated Pages URL and submit a test vote.
6. Confirm that a row appears in the Google Sheet.

The app uses hash routes such as `#/article/1`, so it works on GitHub Pages without server-side rewrite rules and also works from a project URL such as `https://ORG.github.io/REPOSITORY/`.

## What changed from the original app

The original app persisted a vote by republishing the entire HTML document through a Claude artifact capability. That capability does not exist on GitHub Pages. The GitHub-ready version instead:

- sends vote/comment submissions to Apps Script;
- confirms the write with a verification token before showing success;
- uses an Apps Script script lock to protect simultaneous row updates;
- updates an existing response row when the same browser edits its vote for an article;
- loads shared votes/comments from the Sheet so the results dashboard still works;
- downloads CSV with the browser's standard `Blob`/download APIs instead of a Claude-specific download capability;
- removes the large duplicated HTML/CSS template that was only needed to republish the artifact.

## Response Sheet columns

`SubmittedAt`, `UpdatedAt`, `ResponseId`, `VerifyHash`, `ArticleNumber`, `ArticleRoman`, `ArticleTitle`, `Name`, `Institution`, `Role`, `Vote`, `Comment`, `Language`, `PageUrl`.

The verification token itself is **not** stored in the Sheet; only its SHA-256 hash is stored. User-entered strings that begin with spreadsheet formula characters are neutralized before being written to reduce formula-injection risk.

## Privacy and voting integrity

`PUBLIC_RESULTS` is set to `true` in `Code.gs` to preserve the current app's results dashboard and comment feed. That means names, institutions, roles, votes, and comments can be retrieved through the public Apps Script read endpoint. If those responses should not be public, set `PUBLIC_RESULTS = false` and redesign/disable the shared results/comment views in `index.html`.

This is a consultation/voting collection mechanism, **not an authenticated election system**. A participant can create another response by using another browser/device or clearing local storage, and a determined attacker can submit directly to a public Apps Script endpoint. If AHSIA needs strict one-person-one-vote enforcement, eligibility checks, secret ballots, or auditable authentication, add an identity layer (for example, managed sign-in or one-time server-issued voter tokens) rather than relying on browser local storage.

## Updating the Apps Script later

When `Code.gs` changes, update the existing Apps Script deployment to a new version. Keeping the same deployment generally lets you keep the same `/exec` URL, depending on how you update the deployment in the Apps Script UI.
