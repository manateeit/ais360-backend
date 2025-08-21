/* eslint-disable no-console */
// test_netsuite_rest_search.js
// Minimal NetSuite REST test harness using OAuth 1.0a and .env

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const axios = require('axios');
const OAuth = require('oauth-1.0a');
const crypto = require('crypto');

const cfg = {
  accountId: process.env.ACCOUNT_ID || process.env.NETSUITE_ACCOUNT_ID,
  accountRegionId: process.env.ACCOUNT_REGION_ID, // optional informational
  consumerKey: process.env.CONSUMER_KEY || process.env.NETSUITE_CONSUMER_KEY,
  consumerSecret: process.env.CONSUMER_SECRET || process.env.NETSUITE_CONSUMER_SECRET,
  tokenId: process.env.TOKEN_ID || process.env.NETSUITE_TOKEN_ID,
  tokenSecret: process.env.TOKEN_SECRET || process.env.NETSUITE_TOKEN_SECRET,
  roleId: process.env.ROLE_ID,
  userId: process.env.USER_ID,
  baseUrl:
    process.env.REST_BASE_URL ||
    ((process.env.ACCOUNT_ID || process.env.NETSUITE_ACCOUNT_ID)
      ? `https://${process.env.ACCOUNT_ID || process.env.NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com`
      : ''),
  logLevel: process.env.LOG_LEVEL || 'info',
  mode: process.env.TEST_MODE || process.env.npm_config_mode || 'invoice',
  savedSearchId: process.env.SAVED_SEARCH_ID,
  oauthSigMethod: (process.env.OAUTH_SIG_METHOD || 'HMAC-SHA256').toUpperCase(),
  employeeIds: (process.env.EMPLOYEE_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

function mask(v) {
  if (!v) return 'MISSING';
  return v.length <= 6 ? `${v[0]}***${v[v.length - 1]}` : `${v.slice(0, 3)}***${v.slice(-3)}`;
}

function logDebug(...args) {
  if (['debug', 'trace'].includes(cfg.logLevel)) console.log('[DEBUG]', ...args);
}

function requireEnv() {
  const missing = [];
  const has = (primary, alt) => process.env[primary] || process.env[alt];
  if (!has('ACCOUNT_ID', 'NETSUITE_ACCOUNT_ID')) missing.push('ACCOUNT_ID|NETSUITE_ACCOUNT_ID');
  if (!has('CONSUMER_KEY', 'NETSUITE_CONSUMER_KEY')) missing.push('CONSUMER_KEY|NETSUITE_CONSUMER_KEY');
  if (!has('CONSUMER_SECRET', 'NETSUITE_CONSUMER_SECRET')) missing.push('CONSUMER_SECRET|NETSUITE_CONSUMER_SECRET');
  if (!has('TOKEN_ID', 'NETSUITE_TOKEN_ID')) missing.push('TOKEN_ID|NETSUITE_TOKEN_ID');
  if (!has('TOKEN_SECRET', 'NETSUITE_TOKEN_SECRET')) missing.push('TOKEN_SECRET|NETSUITE_TOKEN_SECRET');
  if (!cfg.baseUrl) missing.push('REST_BASE_URL or ACCOUNT_ID/NETSUITE_ACCOUNT_ID');
  if (missing.length) {
    console.error('Missing required env vars:', missing.join(', '));
    process.exit(1);
  }
}

function buildOAuthHeader(method, url) {
  // Choose signature method
  const methodName = cfg.oauthSigMethod === 'HMAC-SHA1' ? 'HMAC-SHA1' : 'HMAC-SHA256';
  const hashFn = (base_string, key) =>
    crypto
      .createHmac(methodName === 'HMAC-SHA1' ? 'sha1' : 'sha256', key)
      .update(base_string)
      .digest('base64');

  const oauth = new OAuth({
    consumer: { key: cfg.consumerKey, secret: cfg.consumerSecret },
    signature_method: methodName,
    hash_function: hashFn,
  });
  const token = { key: cfg.tokenId, secret: cfg.tokenSecret };
  // IMPORTANT: For JSON requests, do NOT include the body in the signature base string.
  // Only include data when Content-Type is application/x-www-form-urlencoded.
  const authData = oauth.authorize({ url, method }, token);
  const hdr = oauth.toHeader(authData);
  // NetSuite requires realm (account ID) in the OAuth header
  const realm = cfg.accountId;
  const auth = hdr.Authorization.startsWith('OAuth ')
    ? `OAuth realm=\"${realm}\", ${hdr.Authorization.slice('OAuth '.length)}`
    : `${hdr.Authorization}, realm=\"${realm}\"`;
  return auth;
}

async function doRequest(pathname, body) {
  const url = `${cfg.baseUrl}${pathname}`;
  const method = 'POST';
  const data = body || {};
  const headers = {
    'Content-Type': 'application/json',
    Authorization: buildOAuthHeader(method, url),
  };

  logDebug('Request URL:', url);
  logDebug('Auth parts present:', {
    accountId: mask(cfg.accountId),
    consumerKey: mask(cfg.consumerKey),
    consumerSecret: mask(cfg.consumerSecret),
    tokenId: mask(cfg.tokenId),
    tokenSecret: mask(cfg.tokenSecret),
    roleId: cfg.roleId || 'n/a',
    userId: cfg.userId || 'n/a',
  });

  try {
    const res = await axios.post(url, data, { headers, timeout: 20000 });
    console.log('Status:', res.status, res.statusText);
    console.log('Body snippet:', JSON.stringify(res.data).slice(0, 1000));
    return res.data;
  } catch (err) {
    if (err.response) {
      console.error('Status:', err.response.status, err.response.statusText);
      console.error('Response:', JSON.stringify(err.response.data));
    } else {
      console.error('Request error:', err.message);
    }
    throw err;
  }
}

function getSuiteqlPreset(name) {
  const presets = {
    // Minimal: IDs + due/completed dates (validated working)
    er_list_min:
      "SELECT id, custrecord20 AS estimate_due_date, custrecord21 AS estimate_completed FROM customrecord417 WHERE custrecord21 IS NULL ORDER BY id DESC FETCH NEXT 5 ROWS ONLY",

    // With employee and job names (validated working)
    er_list_with_names:
      "SELECT er.id, job.entityid AS job_name, COALESCE(emp.altname, emp.entityid) AS assigned_to_name, COALESCE(rby.altname, rby.entityid) AS requested_by_name, er.custrecord20 AS estimate_due_date, er.custrecord21 AS estimate_completed FROM customrecord417 er LEFT JOIN job job ON job.id = er.custrecord_er_job LEFT JOIN entity emp ON emp.id = er.custrecord19 AND emp.type = 'Employee' LEFT JOIN entity rby ON rby.id = er.custrecord_er_req_by AND rby.type = 'Employee' WHERE er.custrecord21 IS NULL ORDER BY er.id DESC FETCH NEXT 5 ROWS ONLY",

    // With company name via job.customer
    er_list_with_company:
      "SELECT er.id, job.entityid AS job_name, COALESCE(c.companyname, c.entityid) AS company_name, COALESCE(emp.altname, emp.entityid) AS assigned_to_name, COALESCE(rby.altname, rby.entityid) AS requested_by_name, er.custrecord20 AS estimate_due_date, er.custrecord21 AS estimate_completed FROM customrecord417 er LEFT JOIN job job ON job.id = er.custrecord_er_job LEFT JOIN customer c ON c.id = job.customer LEFT JOIN entity emp ON emp.id = er.custrecord19 AND emp.type = 'Employee' LEFT JOIN entity rby ON rby.id = er.custrecord_er_req_by AND rby.type = 'Employee' WHERE er.custrecord21 IS NULL ORDER BY er.id DESC FETCH NEXT 5 ROWS ONLY",

    // View screen fields (safe set). NOTE: Excludes custrecord_er_job_addr because it is not stored/exposed in SuiteQL on some accounts.
    er_view_full:
      "SELECT er.id, job.entityid AS job_name, COALESCE(emp.altname, emp.entityid) AS assigned_to_name, COALESCE(rby.altname, rby.entityid) AS requested_by_name, er.custrecord18 AS status_id, er.custrecord17 AS priority_id, er.custrecord_er_date_submitted AS date_submitted, er.custrecord20 AS estimate_due_date, er.custrecord21 AS estimate_completed, er.custrecord40 AS completed_sell_amount, er.custrecord41 AS completed_cost_amount, er.custrecord42 AS completed_gp, er.custrecord27 AS union_labor, er.custrecord28 AS mbe_dbe_wbe, er.custrecord31 AS perf_bond_required, er.custrecord32 AS perf_bond_amount, er.custrecord33 AS perf_bond_rate_pct, er.custrecord34 AS liquidated_damages, er.custrecord35 AS liquidated_damages_per_day, er.custrecord12 AS bid_due_date, er.custrecord13 AS rfi_due_date, er.custrecord14 AS rfi_response_date, er.custrecord36 AS job_status_text, er.custrecord_er_job_desc AS job_description, er.custrecord37 AS estimate_request_note, er.custrecord43 AS estimator_note, er.custrecord38 AS box_link, er.custrecord39 AS completed_estimate_link, er.custrecord22 AS bid_to_owner_gc_id, er.custrecord24 AS drawings_reviewed_id, er.custrecord25 AS takeoff_completed_id, er.custrecord26 AS message_schedule_id, er.custrecord30 AS minority_pct, er.custrecord23 AS amount_of_bidders, er.custrecordrfi_to AS rfi_to_email FROM customrecord417 er LEFT JOIN job job ON job.id = er.custrecord_er_job LEFT JOIN entity emp ON emp.id = er.custrecord19 AND emp.type = 'Employee' LEFT JOIN entity rby ON rby.id = er.custrecord_er_req_by AND rby.type = 'Employee' ORDER BY er.id DESC FETCH NEXT 5 ROWS ONLY",

    // View a single record by id (safe fields + company name). Requires RECORD_ID env var.
    er_view_by_id: (function() {
      const rid = process.env.RECORD_ID || '0';
      return `SELECT er.id, job.entityid AS job_name, COALESCE(c.companyname, c.entityid) AS company_name, COALESCE(emp.altname, emp.entityid) AS assigned_to_name, COALESCE(rby.altname, rby.entityid) AS requested_by_name, er.custrecord18 AS status_id, er.custrecord17 AS priority_id, er.custrecord_er_date_submitted AS date_submitted, er.custrecord20 AS estimate_due_date, er.custrecord21 AS estimate_completed, er.custrecord40 AS completed_sell_amount, er.custrecord41 AS completed_cost_amount, er.custrecord42 AS completed_gp, er.custrecord27 AS union_labor, er.custrecord28 AS mbe_dbe_wbe, er.custrecord31 AS perf_bond_required, er.custrecord32 AS perf_bond_amount, er.custrecord33 AS perf_bond_rate_pct, er.custrecord34 AS liquidated_damages, er.custrecord35 AS liquidated_damages_per_day, er.custrecord12 AS bid_due_date, er.custrecord13 AS rfi_due_date, er.custrecord14 AS rfi_response_date, er.custrecord36 AS job_status_text, er.custrecord_er_job_desc AS job_description, er.custrecord37 AS estimate_request_note, er.custrecord43 AS estimator_note, er.custrecord38 AS box_link, er.custrecord39 AS completed_estimate_link, er.custrecord22 AS bid_to_owner_gc_id, er.custrecord24 AS drawings_reviewed_id, er.custrecord25 AS takeoff_completed_id, er.custrecord26 AS message_schedule_id, er.custrecord30 AS minority_pct, er.custrecord23 AS amount_of_bidders, er.custrecordrfi_to AS rfi_to_email FROM customrecord417 er LEFT JOIN job job ON job.id = er.custrecord_er_job LEFT JOIN customer c ON c.id = job.customer LEFT JOIN entity emp ON emp.id = er.custrecord19 AND emp.type = 'Employee' LEFT JOIN entity rby ON rby.id = er.custrecord_er_req_by AND rby.type = 'Employee' WHERE er.id = ${rid}`;
    })()
  };
  return presets[name];
}

async function run() {
  requireEnv();
  console.log('Running mode:', cfg.mode);

  if (cfg.mode === 'invoice') {
    // REST Records search endpoint is record-type specific
    await doRequest('/services/rest/record/v1/invoice/search', {
      // Minimal request; many accounts accept empty body for basic search
      // If your account requires explicit columns:
      // columns: [{ fieldId: 'internalid' }, { fieldId: 'tranid' }],
      limit: 1,
      offset: 0,
    });
    return;
  }

  if (cfg.mode === 'employee') {
    const values = cfg.employeeIds.length ? cfg.employeeIds : undefined;
    await doRequest('/services/rest/record/v1/employee/search', {
      // Keep the body minimal to avoid schema mismatches across accounts
      filters: values ? [{ fieldId: 'internalid', operator: 'ANY_OF', values }] : undefined,
      columns: [{ fieldId: 'internalid' }, { fieldId: 'entityid' }],
      limit: 5,
      offset: 0,
    });
    return;
  }

  if (cfg.mode === 'savedsearch') {
    if (!cfg.savedSearchId) {
      console.error('Set SAVED_SEARCH_ID in .env or pass TEST_MODE=savedsearch');
      process.exit(1);
    }
    const recordType = process.env.SAVED_SEARCH_RECORD_TYPE || 'employee';
    await doRequest(`/services/rest/record/v1/${recordType}/search`, {
      savedSearchId: cfg.savedSearchId,
      limit: 10,
      offset: 0,
    });
    return;
  }

  if (cfg.mode === 'suiteql') {
    // Test SuiteQL via REST Query Service
    const pathname = '/services/rest/query/v1/suiteql';
    // Allow either raw SUITEQL_QUERY or a preset name in SUITEQL_PRESET
    const presetName = process.env.SUITEQL_PRESET;
    const presetQuery = presetName ? getSuiteqlPreset(presetName) : undefined;
    const q = process.env.SUITEQL_QUERY || presetQuery || "SELECT id, entityid FROM job FETCH NEXT 1 ROWS ONLY";
    const body = { q };
    // NetSuite recommends Prefer: transient for faster execution
    const url = `${cfg.baseUrl}${pathname}`;
    const method = 'POST';
    const headers = {
      'Content-Type': 'application/json',
      'Prefer': 'transient',
      Authorization: buildOAuthHeader(method, url),
    };
    logDebug('Request URL:', url);
    try {
      const res = await axios.post(url, body, { headers, timeout: 20000 });
      console.log('Status:', res.status, res.statusText);
      const out = process.env.PRINT_FULL === '1' ? JSON.stringify(res.data, null, 2) : JSON.stringify(res.data).slice(0, 1000);
      console.log(process.env.PRINT_FULL === '1' ? out : `Body snippet: ${out}`);
      return;
    } catch (err) {
      if (err.response) {
        console.error('Status:', err.response.status, err.response.statusText);
        console.error('Response:', JSON.stringify(err.response.data));
      } else {
        console.error('Request error:', err.message);
      }
      process.exit(1);
    }
  }

  console.error('Unknown TEST_MODE:', cfg.mode);
  process.exit(1);
}

run().catch(() => process.exit(1));

