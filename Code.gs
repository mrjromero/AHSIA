/**
 * AHSIA Constitution Review - Google Apps Script backend
 *
 * Recommended setup:
 * 1. Create/open the Google Sheet that will hold responses.
 * 2. Extensions > Apps Script, paste this file into Code.gs.
 * 3. Run setup() once from the editor and authorize it.
 * 4. Deploy as a Web app that executes as the deploying user and is accessible
 *    to the people who will use the public GitHub Pages site.
 * 5. Paste the deployed /exec URL into APPS_SCRIPT_URL in index.html.
 */

const SHEET_NAME = 'Responses';
const PUBLIC_RESULTS = true; // IMPORTANT: true exposes name/institution/role/vote/comment via the public read endpoint.

const HEADERS = [
  'SubmittedAt',
  'UpdatedAt',
  'ResponseId',
  'VerifyHash',
  'ArticleNumber',
  'ArticleRoman',
  'ArticleTitle',
  'Name',
  'Institution',
  'Role',
  'Vote',
  'Comment',
  'Language',
  'PageUrl'
];

const COL = {
  SUBMITTED_AT: 1,
  UPDATED_AT: 2,
  RESPONSE_ID: 3,
  VERIFY_HASH: 4,
  ARTICLE_NUMBER: 5,
  ARTICLE_ROMAN: 6,
  ARTICLE_TITLE: 7,
  NAME: 8,
  INSTITUTION: 9,
  ROLE: 10,
  VOTE: 11,
  COMMENT: 12,
  LANGUAGE: 13,
  PAGE_URL: 14
};

const ARTICLE_META = {
  1:  { roman: 'I',    title: 'Name, History and Location' },
  2:  { roman: 'II',   title: 'Members' },
  3:  { roman: 'III',  title: 'Purpose' },
  4:  { roman: 'IV',   title: 'Operations' },
  5:  { roman: 'V',    title: 'Functions of the Officers' },
  6:  { roman: 'VI',   title: 'Quorum' },
  7:  { roman: 'VII',  title: 'Finances' },
  8:  { roman: 'VIII', title: 'Technical Partners' },
  9:  { roman: 'IX',   title: 'Liability and Indemnity' },
  10: { roman: 'X',    title: 'Dissolution' },
  11: { roman: 'XI',   title: 'Conflict of Interest' },
  12: { roman: 'XII',  title: 'Annexes' },
  13: { roman: 'XIII', title: 'Bylaws Amendment Standards for Member Institutions' }
};

/** Run once from the Apps Script editor while this script is bound to the target Sheet. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('Open the target Google Sheet and create this Apps Script from Extensions > Apps Script, then run setup() again.');
  }

  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  const sheet = ensureSheet_(ss);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  sheet.autoResizeColumns(1, HEADERS.length);

  return 'Configured spreadsheet: ' + ss.getName() + ' (' + ss.getId() + ')';
}

function doPost(e) {
  try {
    const p = (e && e.parameter) || {};
    if ((p.action || 'submit') !== 'submit') {
      return json_({ ok: false, code: 'unsupported_action' });
    }

    // Honeypot. Human users never see/fill this field.
    if (String(p.website || '').trim()) {
      return json_({ ok: false, code: 'rejected' });
    }

    const submission = validateSubmission_(p);
    const saved = upsertSubmission_(submission);
    return json_({ ok: true, responseId: saved.id, updated: saved.updated });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, code: errorCode_(err), message: safeErrorMessage_(err) });
  }
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    const action = String(p.action || 'health');
    let result;

    if (action === 'health') {
      result = { ok: true, service: 'AHSIA Constitution Review', timestamp: Date.now() };
    } else if (action === 'verify') {
      result = verifySubmission_(p);
    } else if (action === 'list') {
      if (!PUBLIC_RESULTS) {
        result = { ok: false, code: 'public_results_disabled', responses: {} };
      } else {
        result = { ok: true, responses: readAllResponses_(), timestamp: Date.now() };
      }
    } else {
      result = { ok: false, code: 'unsupported_action' };
    }

    return respond_(result, p.callback);
  } catch (err) {
    console.error(err);
    return respond_({ ok: false, code: errorCode_(err), message: safeErrorMessage_(err) }, p.callback);
  }
}

function validateSubmission_(p) {
  const articleNumber = Number(p.articleNumber);
  const article = ARTICLE_META[articleNumber];
  if (!article) throw codedError_('invalid_article', 'Article number must be between 1 and 13.');

  const vote = String(p.vote || '').trim().toLowerCase();
  if (!['accept', 'table', 'reject'].includes(vote)) {
    throw codedError_('invalid_vote', 'Vote must be accept, table, or reject.');
  }

  const responseId = bounded_(p.responseId, 120, true);
  if (!/^r_[A-Za-z0-9_-]{6,110}$/.test(responseId)) {
    throw codedError_('invalid_response_id', 'Invalid response ID.');
  }

  const verifyToken = bounded_(p.verifyToken, 180, true);
  if (!/^[A-Za-z0-9_-]{20,180}$/.test(verifyToken)) {
    throw codedError_('invalid_verify_token', 'Invalid verification token.');
  }

  const name = bounded_(p.name, 150, true);
  const institution = bounded_(p.institution, 220, true);
  if (!name || !institution) {
    throw codedError_('missing_identity', 'Name and institution are required.');
  }

  const role = bounded_(p.role, 180, false);
  const comment = bounded_(p.comment, 5000, false);
  const language = String(p.language || 'en').toLowerCase();
  if (!['en', 'es', 'fr'].includes(language)) {
    throw codedError_('invalid_language', 'Unsupported language.');
  }

  return {
    id: responseId,
    verifyToken: verifyToken,
    verifyHash: sha256Hex_(verifyToken),
    articleNumber: articleNumber,
    articleRoman: article.roman,
    articleTitle: article.title,
    name: name,
    institution: institution,
    role: role,
    vote: vote,
    comment: comment,
    language: language,
    pageUrl: bounded_(p.pageUrl, 600, false)
  };
}

function upsertSubmission_(s) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = getSheet_();
    const existingRow = findRowByResponseId_(sheet, s.id);
    const now = new Date();
    let submittedAt = now;
    let updated = false;

    if (existingRow) {
      const storedHash = String(sheet.getRange(existingRow, COL.VERIFY_HASH).getValue() || '');
      if (!constantTimeEqual_(storedHash, s.verifyHash)) {
        throw codedError_('edit_not_authorized', 'This response cannot be edited from this browser.');
      }
      submittedAt = sheet.getRange(existingRow, COL.SUBMITTED_AT).getValue() || now;
      updated = true;
    }

    const row = [
      submittedAt,
      now,
      s.id,
      s.verifyHash,
      s.articleNumber,
      s.articleRoman,
      safeSheetText_(s.articleTitle),
      safeSheetText_(s.name),
      safeSheetText_(s.institution),
      safeSheetText_(s.role),
      s.vote,
      safeSheetText_(s.comment),
      s.language,
      safeSheetText_(s.pageUrl)
    ];

    if (existingRow) {
      sheet.getRange(existingRow, 1, 1, HEADERS.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }
    SpreadsheetApp.flush();

    return { id: s.id, updated: updated };
  } finally {
    lock.releaseLock();
  }
}

function verifySubmission_(p) {
  const responseId = bounded_(p.responseId, 120, true);
  const verifyToken = bounded_(p.verifyToken, 180, true);
  if (!responseId || !verifyToken) return { ok: false, code: 'missing_verification', exists: false };

  const sheet = getSheet_();
  const rowNumber = findRowByResponseId_(sheet, responseId);
  if (!rowNumber) return { ok: true, exists: false };

  const row = sheet.getRange(rowNumber, 1, 1, HEADERS.length).getValues()[0];
  const expectedHash = String(row[COL.VERIFY_HASH - 1] || '');
  const actualHash = sha256Hex_(verifyToken);
  if (!constantTimeEqual_(expectedHash, actualHash)) {
    return { ok: false, code: 'verification_failed', exists: false };
  }

  return { ok: true, exists: true, record: rowToPublicRecord_(row) };
}

function readAllResponses_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  const grouped = {};
  if (lastRow < 2) return grouped;

  const rows = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  rows.forEach(function(row) {
    const articleNumber = Number(row[COL.ARTICLE_NUMBER - 1]);
    if (!ARTICLE_META[articleNumber]) return;
    const record = rowToPublicRecord_(row);
    if (!grouped[articleNumber]) grouped[articleNumber] = [];
    grouped[articleNumber].push(record);
  });

  return grouped;
}

function rowToPublicRecord_(row) {
  const updatedAt = row[COL.UPDATED_AT - 1];
  const submittedAt = row[COL.SUBMITTED_AT - 1];
  const ts = updatedAt instanceof Date ? updatedAt.getTime()
    : submittedAt instanceof Date ? submittedAt.getTime()
    : Date.now();

  return {
    id: String(row[COL.RESPONSE_ID - 1] || ''),
    name: restoreSheetText_(row[COL.NAME - 1]),
    org: restoreSheetText_(row[COL.INSTITUTION - 1]),
    role: restoreSheetText_(row[COL.ROLE - 1]),
    vote: String(row[COL.VOTE - 1] || ''),
    comment: restoreSheetText_(row[COL.COMMENT - 1]),
    ts: ts
  };
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) {
    throw codedError_('not_configured', 'Run setup() once from the Apps Script editor before deploying the web app.');
  }
  return SpreadsheetApp.openById(id);
}

function getSheet_() {
  return ensureSheet_(getSpreadsheet_());
}

function ensureSheet_(ss) {
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  } else {
    const existing = sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0];
    const mismatch = HEADERS.some(function(h, i) { return existing[i] !== h; });
    if (mismatch) {
      throw codedError_('header_mismatch', 'The Responses sheet header row does not match the expected schema.');
    }
  }
  return sheet;
}

function findRowByResponseId_(sheet, responseId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const values = sheet.getRange(2, COL.RESPONSE_ID, lastRow - 1, 1).getDisplayValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === responseId) return i + 2;
  }
  return 0;
}

function bounded_(value, max, required) {
  let s = String(value == null ? '' : value).trim();
  if (s.length > max) s = s.slice(0, max);
  if (required && !s) throw codedError_('missing_field', 'A required field is missing.');
  return s;
}

// Protect the Sheet against formula injection while preserving what users see in the app.
function safeSheetText_(value) {
  const s = String(value == null ? '' : value);
  return /^[=+\-@]/.test(s) ? '\u200B' + s : s;
}

function restoreSheetText_(value) {
  const s = String(value == null ? '' : value);
  return s.charAt(0) === '\u200B' ? s.slice(1) : s;
}

function sha256Hex_(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function(b) {
    const v = (b + 256) % 256;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

function constantTimeEqual_(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function respond_(payload, callback) {
  const cb = String(callback || '');
  if (cb) {
    if (!/^[A-Za-z_$][0-9A-Za-z_$]{0,127}$/.test(cb)) {
      return json_({ ok: false, code: 'invalid_callback' });
    }
    return ContentService
      .createTextOutput(cb + '(' + JSON.stringify(payload) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json_(payload);
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function codedError_(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

function errorCode_(err) {
  return (err && err.code) ? String(err.code) : 'server_error';
}

function safeErrorMessage_(err) {
  const code = errorCode_(err);
  const known = {
    invalid_article: 'Invalid article.',
    invalid_vote: 'Invalid vote.',
    invalid_response_id: 'Invalid response ID.',
    invalid_verify_token: 'Invalid verification token.',
    missing_identity: 'Name and institution are required.',
    invalid_language: 'Unsupported language.',
    missing_field: 'A required field is missing.',
    edit_not_authorized: 'This response cannot be edited from this browser.',
    not_configured: 'Backend setup is incomplete.',
    header_mismatch: 'The response sheet schema is not valid.'
  };
  return known[code] || 'The request could not be completed.';
}
