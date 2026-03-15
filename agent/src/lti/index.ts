import { createRemoteJWKSet, importJWK, jwtVerify, SignJWT } from "jose";
import { generateRevealHtml } from "./revealHtml.js";

const CLAIM_MESSAGE_TYPE = "https://purl.imsglobal.org/spec/lti/claim/message_type";
const CLAIM_VERSION = "https://purl.imsglobal.org/spec/lti/claim/version";
const CLAIM_DEPLOYMENT_ID = "https://purl.imsglobal.org/spec/lti/claim/deployment_id";
const CLAIM_DEEP_LINKING_SETTINGS =
  "https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings";
const CLAIM_CONTENT_ITEMS = "https://purl.imsglobal.org/spec/lti-dl/claim/content_items";
const CLAIM_DATA = "https://purl.imsglobal.org/spec/lti-dl/claim/data";

const SESSION_TTL_SECONDS = 10 * 60;
const CLOCK_SKEW_SECONDS = 30;

type Env = {
  LTI_TOOL_CLIENT_ID?: string;
  LTI_TOOL_PRIVATE_JWK?: string;
  LTI_TOOL_PUBLIC_JWK?: string;
  LTI_TOOL_KID?: string;
  LTI_STATE_SECRET?: string;
  LTI_ALLOWED_ISSUERS?: string;
  LTI_TOOL_BASE_URL?: string;
  LTI_TOOL_TITLE?: string;
  LTI_TOOL_DESCRIPTION?: string;
};

type OpenIdConfig = {
  authorizationEndpoint: string;
  jwksUri: string;
};

type StatePayload = {
  v: 1;
  iss: string;
  clientId: string;
  nonce: string;
  iat: number;
  exp: number;
};

type LaunchContextPayload = {
  v: 1;
  iss: string;
  clientId: string;
  deploymentId: string;
  deepLinkReturnUrl: string;
  data?: string;
  iat: number;
  exp: number;
};

type ToolKeys = {
  alg: string;
  kid: string;
  privateKey: CryptoKey;
  publicJwk: JsonWebKey;
};

type LaunchClaims = {
  iss: string;
  nonce?: string;
  [CLAIM_MESSAGE_TYPE]?: string;
  [CLAIM_DEEP_LINKING_SETTINGS]?: unknown;
  [CLAIM_DEPLOYMENT_ID]?: unknown;
};

const encoder = new TextEncoder();
const openIdConfigCache = new Map<string, { config: OpenIdConfig; expiresAt: number }>();
let cachedToolKeys:
  | {
    cacheKey: string;
    keys: ToolKeys;
  }
  | undefined;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function htmlEscape(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function randomUrlSafe(length = 24): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): Uint8Array {
  const padding = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/") + padding;
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function nowEpochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function hmacSign(secret: string, text: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(text));
  return new Uint8Array(signature);
}

async function signPayload(secret: string, payload: StatePayload | LaunchContextPayload): Promise<string> {
  const encodedPayload = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await hmacSign(secret, encodedPayload);
  return `${encodedPayload}.${toBase64Url(signature)}`;
}

async function verifySignedPayload<T extends { iat: number; exp: number; v: 1 }>(
  token: string,
  secret: string
): Promise<T> {
  const dotIndex = token.indexOf(".");
  if (dotIndex <= 0 || dotIndex >= token.length - 1) {
    throw new Error("Malformed token.");
  }
  const encodedPayload = token.slice(0, dotIndex);
  const encodedSignature = token.slice(dotIndex + 1);
  const expectedSignature = await hmacSign(secret, encodedPayload);
  const providedSignature = fromBase64Url(encodedSignature);

  if (providedSignature.length !== expectedSignature.length) {
    throw new Error("Invalid token signature.");
  }

  let mismatch = 0;
  for (let i = 0; i < providedSignature.length; i += 1) {
    mismatch |= providedSignature[i] ^ expectedSignature[i];
  }
  if (mismatch !== 0) {
    throw new Error("Invalid token signature.");
  }

  const payloadText = new TextDecoder().decode(fromBase64Url(encodedPayload));
  const payload = JSON.parse(payloadText) as T;
  if (payload.v !== 1) {
    throw new Error("Unsupported token version.");
  }
  const now = nowEpochSeconds();
  if (payload.iat > now + CLOCK_SKEW_SECONDS) {
    throw new Error("Token issued in the future.");
  }
  if (payload.exp < now - CLOCK_SKEW_SECONDS) {
    throw new Error("Token expired.");
  }
  return payload;
}

function getRequiredEnv(value: string | undefined, name: string): string {
  if (!value || !value.trim()) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value.trim();
}

function getToolBaseUrl(request: Request, env: Env): string {
  const configured = env.LTI_TOOL_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  const fromRequest = new URL(request.url).origin;
  return fromRequest.replace(/\/+$/, "");
}

function parseAllowedIssuers(env: Env): Set<string> {
  const raw = env.LTI_ALLOWED_ISSUERS?.trim();
  if (!raw) {
    return new Set<string>();
  }
  return new Set(
    raw
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  );
}

function ensureIssuerAllowed(issuer: string, env: Env): void {
  if (!issuer.startsWith("https://")) {
    throw new Error("Issuer must be https.");
  }
  const allowed = parseAllowedIssuers(env);
  if (allowed.size === 0) {
    return;
  }
  if (!allowed.has(issuer)) {
    throw new Error(`Issuer not allowed: ${issuer}`);
  }
}

async function parseRequestParams(request: Request): Promise<URLSearchParams> {
  const url = new URL(request.url);
  const params = new URLSearchParams(url.search);
  if (request.method !== "POST") {
    return params;
  }

  const contentType = (request.headers.get("Content-Type") ?? "").toLowerCase();
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const body = await request.text();
    const bodyParams = new URLSearchParams(body);
    for (const [key, value] of bodyParams.entries()) {
      params.set(key, value);
    }
    return params;
  }

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") {
        params.set(key, value);
      }
    }
  }

  return params;
}

async function getOpenIdConfig(issuer: string): Promise<OpenIdConfig> {
  const cached = openIdConfigCache.get(issuer);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.config;
  }

  const url = `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load OpenID configuration from ${issuer} (${response.status}).`);
  }
  const json = (await response.json()) as Record<string, unknown>;
  const authorizationEndpoint = typeof json.authorization_endpoint === "string"
    ? json.authorization_endpoint
    : undefined;
  const jwksUri = typeof json.jwks_uri === "string" ? json.jwks_uri : undefined;
  if (!authorizationEndpoint || !jwksUri) {
    throw new Error("OpenID configuration is missing required endpoints.");
  }

  const config: OpenIdConfig = { authorizationEndpoint, jwksUri };
  openIdConfigCache.set(issuer, {
    config,
    expiresAt: now + 10 * 60 * 1000
  });
  return config;
}

function derivePublicJwk(privateJwk: JsonWebKey, kid: string, alg: string): JsonWebKey {
  if (!privateJwk.kty) {
    throw new Error("LTI_TOOL_PRIVATE_JWK must include kty.");
  }
  if (privateJwk.kty === "oct") {
    throw new Error("Symmetric JWK (kty=oct) is not supported for LTI tool signing.");
  }

  const publicJwk: JsonWebKey = {
    kty: privateJwk.kty,
    use: "sig",
    alg,
    kid
  };

  if (privateJwk.kty === "RSA") {
    if (!privateJwk.n || !privateJwk.e) {
      throw new Error("RSA private JWK must include n and e.");
    }
    publicJwk.n = privateJwk.n;
    publicJwk.e = privateJwk.e;
  } else if (privateJwk.kty === "EC") {
    if (!privateJwk.crv || !privateJwk.x || !privateJwk.y) {
      throw new Error("EC private JWK must include crv, x, and y.");
    }
    publicJwk.crv = privateJwk.crv;
    publicJwk.x = privateJwk.x;
    publicJwk.y = privateJwk.y;
  } else if (privateJwk.kty === "OKP") {
    if (!privateJwk.crv || !privateJwk.x) {
      throw new Error("OKP private JWK must include crv and x.");
    }
    publicJwk.crv = privateJwk.crv;
    publicJwk.x = privateJwk.x;
  }

  return publicJwk;
}

async function getToolKeys(env: Env): Promise<ToolKeys> {
  const privateJwkJson = getRequiredEnv(env.LTI_TOOL_PRIVATE_JWK, "LTI_TOOL_PRIVATE_JWK");
  const publicJwkJson = env.LTI_TOOL_PUBLIC_JWK?.trim();
  const explicitKid = env.LTI_TOOL_KID?.trim();
  const cacheKey = `${privateJwkJson}::${publicJwkJson ?? ""}::${explicitKid ?? ""}`;
  if (cachedToolKeys && cachedToolKeys.cacheKey === cacheKey) {
    return cachedToolKeys.keys;
  }

  let privateJwk: JsonWebKey;
  try {
    privateJwk = JSON.parse(privateJwkJson) as JsonWebKey;
  } catch {
    throw new Error("LTI_TOOL_PRIVATE_JWK is not valid JSON.");
  }
  const alg = typeof privateJwk.alg === "string" && privateJwk.alg.trim()
    ? privateJwk.alg
    : "RS256";
  const kid = explicitKid || (typeof privateJwk.kid === "string" ? privateJwk.kid : "") || "reveal-answer-key";
  const privateWithMeta: JsonWebKey = {
    ...privateJwk,
    alg,
    kid
  };

  const privateKey = await importJWK(privateWithMeta, alg);

  let publicJwk: JsonWebKey;
  if (publicJwkJson) {
    try {
      publicJwk = JSON.parse(publicJwkJson) as JsonWebKey;
    } catch {
      throw new Error("LTI_TOOL_PUBLIC_JWK is not valid JSON.");
    }
    publicJwk = { ...publicJwk, alg, kid, use: "sig" };
  } else {
    publicJwk = derivePublicJwk(privateWithMeta, kid, alg);
  }

  const keys: ToolKeys = { alg, kid, privateKey, publicJwk };
  cachedToolKeys = { cacheKey, keys };
  return keys;
}

function renderErrorPage(title: string, detail: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${htmlEscape(title)}</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background: #f5f7fb; color: #111827; }
      main { max-width: 760px; margin: 24px auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 20px; }
      h1 { margin: 0 0 10px 0; font-size: 20px; }
      p { margin: 0; line-height: 1.55; color: #374151; white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <main>
      <h1>${htmlEscape(title)}</h1>
      <p>${htmlEscape(detail)}</p>
    </main>
  </body>
</html>`;
}

function renderSelectorPage(input: { launchToken: string; title: string; subtitle: string }): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Nexgen Reveal Answer</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background: #f4f6fb; color: #111827; }
      .wrap { max-width: 860px; margin: 0 auto; padding: 18px; }
      .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; box-shadow: 0 8px 20px rgba(15, 23, 42, 0.06); padding: 16px; }
      h1 { margin: 0 0 6px 0; font-size: 20px; }
      p { margin: 0 0 14px 0; color: #4b5563; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      label { display: block; font-size: 13px; font-weight: 600; margin: 10px 0 6px 0; }
      input, select, textarea { width: 100%; border: 1px solid #d1d5db; border-radius: 10px; padding: 10px; font: inherit; box-sizing: border-box; }
      textarea { min-height: 110px; resize: vertical; }
      .actions { margin-top: 14px; display: flex; justify-content: flex-end; gap: 10px; }
      button { border: 0; border-radius: 10px; background: #111827; color: #fff; padding: 10px 14px; font-weight: 700; cursor: pointer; }
      .muted { font-size: 12px; color: #6b7280; margin-top: 6px; }
      @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>${htmlEscape(input.title)}</h1>
        <p>${htmlEscape(input.subtitle)}</p>
        <form method="post" action="/lti/deep-link">
          <input type="hidden" name="launch_token" value="${htmlEscape(input.launchToken)}">

          <label for="question">Question (optional)</label>
          <textarea id="question" name="question" placeholder="e.g. What is Ohm's Law?"></textarea>

          <label for="answer">Answer (required)</label>
          <textarea id="answer" name="answer" required placeholder="e.g. V = I * R"></textarea>
          <div class="muted">Use plain text by default. Switch escape to false if you want to pass raw HTML.</div>

          <div class="grid">
            <div>
              <label for="mode">Mode</label>
              <select id="mode" name="mode">
                <option value="basic" selected>basic (Canvas-safe)</option>
                <option value="enhanced">enhanced (style-dependent)</option>
              </select>
            </div>
            <div>
              <label for="escape">Escape Input</label>
              <select id="escape" name="escape">
                <option value="true" selected>true</option>
                <option value="false">false (allow raw HTML)</option>
              </select>
            </div>
          </div>

          <div class="grid">
            <div>
              <label for="cta">CTA Title</label>
              <input id="cta" name="cta" value="Click to reveal answer">
            </div>
            <div>
              <label for="helperText">Helper Text</label>
              <input id="helperText" name="helperText" value="Tap this bar to show / hide the answer.">
            </div>
          </div>

          <div class="grid">
            <div>
              <label for="answerLabel">Answer Label</label>
              <input id="answerLabel" name="answerLabel" value="Answer:">
            </div>
            <div>
              <label for="maxWidthPx">Max Width (px)</label>
              <input id="maxWidthPx" name="maxWidthPx" type="number" min="280" max="1600" value="720">
            </div>
          </div>

          <div class="grid">
            <div>
              <label for="panelBackgroundColor">Panel Background</label>
              <input id="panelBackgroundColor" name="panelBackgroundColor" value="#f7f8fb">
            </div>
            <div>
              <label for="panelBorderColor">Panel Border</label>
              <input id="panelBorderColor" name="panelBorderColor" value="#d6d9df">
            </div>
          </div>

          <div class="grid">
            <div>
              <label for="iconBgColor">Icon Background</label>
              <input id="iconBgColor" name="iconBgColor" value="#111827">
            </div>
            <div>
              <label for="titleColor">Title Color</label>
              <input id="titleColor" name="titleColor" value="#111827">
            </div>
          </div>

          <label for="advancedArgsJson">Advanced Args JSON (optional)</label>
          <textarea id="advancedArgsJson" name="advancedArgsJson" placeholder='{"pillText":"Reveal","pillTextOpen":"Hide","fontFamily":"Georgia, serif"}'></textarea>
          <div class="muted">Any supported reveal args can be supplied here as JSON and will override fields above.</div>

          <div class="actions">
            <button type="submit">Insert into Canvas</button>
          </div>
        </form>
      </div>
    </div>
  </body>
</html>`;
}

function renderAutoPostPage(returnUrl: string, jwt: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Returning to Canvas</title>
  </head>
  <body>
    <form id="ltiDeepLinkForm" method="post" action="${htmlEscape(returnUrl)}" target="_top">
      <input type="hidden" name="JWT" value="${htmlEscape(jwt)}">
      <noscript><button type="submit">Return to Canvas</button></noscript>
    </form>
    <script>document.getElementById("ltiDeepLinkForm").submit();</script>
  </body>
</html>`;
}

function toStringMap(form: FormData, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = form.get(key);
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    out[key] = trimmed;
  }
  return out;
}

function mergeAdvancedJsonArgs(base: Record<string, string>, rawJson: FormDataEntryValue | null): Record<string, string> {
  if (typeof rawJson !== "string" || !rawJson.trim()) {
    return base;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("advancedArgsJson is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("advancedArgsJson must be a JSON object.");
  }

  const merged = { ...base };
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === null || value === undefined) {
      continue;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) continue;
      merged[key] = trimmed;
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      merged[key] = String(value);
      continue;
    }
  }
  return merged;
}

function getTitle(env: Env): string {
  return env.LTI_TOOL_TITLE?.trim() || "Nexgen Reveal Answer";
}

function getDescription(env: Env): string {
  return (
    env.LTI_TOOL_DESCRIPTION?.trim() ||
    "Insert a Canvas-friendly click-to-reveal answer block into page content."
  );
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const params = await parseRequestParams(request);
  const issuer = params.get("iss")?.trim();
  const loginHint = params.get("login_hint")?.trim();
  const messageHint = params.get("lti_message_hint")?.trim();
  const targetLinkUri = params.get("target_link_uri")?.trim();
  const requestedClientId = params.get("client_id")?.trim();

  if (!issuer || !loginHint || !targetLinkUri) {
    return htmlResponse(renderErrorPage("LTI Login Error", "Missing required OIDC login params."), 400);
  }

  try {
    ensureIssuerAllowed(issuer, env);
    const clientId = getRequiredEnv(env.LTI_TOOL_CLIENT_ID, "LTI_TOOL_CLIENT_ID");
    if (requestedClientId && requestedClientId !== clientId) {
      return htmlResponse(
        renderErrorPage("LTI Login Error", `Unexpected client_id. Expected ${clientId}.`),
        400
      );
    }

    const stateSecret = getRequiredEnv(env.LTI_STATE_SECRET, "LTI_STATE_SECRET");
    const nonce = randomUrlSafe(20);
    const now = nowEpochSeconds();
    const stateToken = await signPayload(stateSecret, {
      v: 1,
      iss: issuer,
      clientId,
      nonce,
      iat: now,
      exp: now + SESSION_TTL_SECONDS
    });

    const openId = await getOpenIdConfig(issuer);
    const authorizeUrl = new URL(openId.authorizationEndpoint);
    authorizeUrl.searchParams.set("scope", "openid");
    authorizeUrl.searchParams.set("response_type", "id_token");
    authorizeUrl.searchParams.set("response_mode", "form_post");
    authorizeUrl.searchParams.set("prompt", "none");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", targetLinkUri);
    authorizeUrl.searchParams.set("login_hint", loginHint);
    authorizeUrl.searchParams.set("nonce", nonce);
    authorizeUrl.searchParams.set("state", stateToken);
    if (messageHint) {
      authorizeUrl.searchParams.set("lti_message_hint", messageHint);
    }

    return new Response(null, {
      status: 302,
      headers: {
        Location: authorizeUrl.toString(),
        "Cache-Control": "no-store"
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return htmlResponse(renderErrorPage("LTI Login Error", message), 400);
  }
}

async function verifyLaunch(request: Request, env: Env): Promise<{
  claims: LaunchClaims;
  deploymentId: string;
  deepLinkReturnUrl: string;
  data?: string;
  clientId: string;
}> {
  const form = await request.formData();
  const stateRaw = form.get("state");
  const idTokenRaw = form.get("id_token");
  if (typeof stateRaw !== "string" || typeof idTokenRaw !== "string") {
    throw new Error("Launch is missing state or id_token.");
  }

  const stateSecret = getRequiredEnv(env.LTI_STATE_SECRET, "LTI_STATE_SECRET");
  const state = await verifySignedPayload<StatePayload>(stateRaw, stateSecret);
  ensureIssuerAllowed(state.iss, env);

  const openId = await getOpenIdConfig(state.iss);
  const keyset = createRemoteJWKSet(new URL(openId.jwksUri));
  const { payload } = await jwtVerify(idTokenRaw, keyset, {
    issuer: state.iss,
    audience: state.clientId,
    clockTolerance: CLOCK_SKEW_SECONDS
  });

  const claims = payload as unknown as LaunchClaims;
  if (claims.nonce !== state.nonce) {
    throw new Error("Nonce mismatch.");
  }
  if (claims[CLAIM_MESSAGE_TYPE] !== "LtiDeepLinkingRequest") {
    throw new Error(`Unsupported launch message type: ${String(claims[CLAIM_MESSAGE_TYPE] ?? "")}`);
  }

  const deploymentId = typeof claims[CLAIM_DEPLOYMENT_ID] === "string"
    ? claims[CLAIM_DEPLOYMENT_ID]
    : "";
  if (!deploymentId) {
    throw new Error("Missing deployment id claim.");
  }

  const deepLinkingSettings =
    claims[CLAIM_DEEP_LINKING_SETTINGS] && typeof claims[CLAIM_DEEP_LINKING_SETTINGS] === "object"
      ? (claims[CLAIM_DEEP_LINKING_SETTINGS] as Record<string, unknown>)
      : undefined;
  if (!deepLinkingSettings) {
    throw new Error("Missing deep linking settings claim.");
  }

  const deepLinkReturnUrl =
    typeof deepLinkingSettings.deep_link_return_url === "string"
      ? deepLinkingSettings.deep_link_return_url
      : "";
  if (!deepLinkReturnUrl) {
    throw new Error("Missing deep_link_return_url.");
  }

  const acceptTypes = Array.isArray(deepLinkingSettings.accept_types)
    ? deepLinkingSettings.accept_types.filter((item): item is string => typeof item === "string")
    : [];
  if (!acceptTypes.includes("html")) {
    throw new Error('Platform did not advertise support for deep-linking type "html".');
  }

  const data = typeof deepLinkingSettings.data === "string" ? deepLinkingSettings.data : undefined;

  return {
    claims,
    deploymentId,
    deepLinkReturnUrl,
    data,
    clientId: state.clientId
  };
}

async function handleLaunch(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return htmlResponse(renderErrorPage("LTI Launch Error", "Launch endpoint requires POST."), 405);
  }

  try {
    const launch = await verifyLaunch(request, env);
    const stateSecret = getRequiredEnv(env.LTI_STATE_SECRET, "LTI_STATE_SECRET");
    const now = nowEpochSeconds();
    const launchToken = await signPayload(stateSecret, {
      v: 1,
      iss: launch.claims.iss,
      clientId: launch.clientId,
      deploymentId: launch.deploymentId,
      deepLinkReturnUrl: launch.deepLinkReturnUrl,
      data: launch.data,
      iat: now,
      exp: now + SESSION_TTL_SECONDS
    });

    return htmlResponse(
      renderSelectorPage({
        launchToken,
        title: getTitle(env),
        subtitle: "Build a reveal-answer block and insert it into the current Canvas page."
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return htmlResponse(renderErrorPage("LTI Launch Error", message), 400);
  }
}

async function handleDeepLinkSubmit(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return htmlResponse(renderErrorPage("LTI Deep Link Error", "Endpoint requires POST."), 405);
  }

  try {
    const form = await request.formData();
    const launchTokenRaw = form.get("launch_token");
    if (typeof launchTokenRaw !== "string" || !launchTokenRaw.trim()) {
      throw new Error("Missing launch token.");
    }

    const stateSecret = getRequiredEnv(env.LTI_STATE_SECRET, "LTI_STATE_SECRET");
    const launch = await verifySignedPayload<LaunchContextPayload>(launchTokenRaw, stateSecret);

    const knownKeys = [
      "mode",
      "escape",
      "question",
      "answer",
      "cta",
      "helperText",
      "answerLabel",
      "pillText",
      "pillTextClosed",
      "pillTextOpen",
      "maxWidthPx",
      "marginYPx",
      "panelRadiusPx",
      "summaryPadYPx",
      "summaryPadXPx",
      "iconSizePx",
      "iconRadiusPx",
      "answerCardRadiusPx",
      "answerCardPaddingPx",
      "baseFontSizePx",
      "answerLineHeight",
      "fontFamily",
      "panelBorderColor",
      "panelBackgroundColor",
      "panelShadow",
      "questionColor",
      "titleColor",
      "helperColor",
      "iconBgColor",
      "iconTextColor",
      "pillTextColor",
      "pillBorderColor",
      "pillBackgroundColor",
      "answerCardBorderColor",
      "answerCardBackgroundColor",
      "answerTextColor",
      "answerLabelColor"
    ];

    const baseArgs = toStringMap(form, knownKeys);
    const revealArgs = mergeAdvancedJsonArgs(baseArgs, form.get("advancedArgsJson"));
    const generated = generateRevealHtml(revealArgs);

    const itemTitleRaw = form.get("itemTitle");
    const itemTitle =
      typeof itemTitleRaw === "string" && itemTitleRaw.trim() ? itemTitleRaw.trim() : getTitle(env);

    const contentItem = {
      type: "html",
      title: itemTitle,
      text: `Reveal answer block (${generated.mode})`,
      html: generated.html
    };

    const keys = await getToolKeys(env);
    const claims: Record<string, unknown> = {
      [CLAIM_MESSAGE_TYPE]: "LtiDeepLinkingResponse",
      [CLAIM_VERSION]: "1.3.0",
      [CLAIM_DEPLOYMENT_ID]: launch.deploymentId,
      [CLAIM_CONTENT_ITEMS]: [contentItem]
    };
    if (launch.data) {
      claims[CLAIM_DATA] = launch.data;
    }

    const responseJwt = await new SignJWT(claims)
      .setProtectedHeader({ alg: keys.alg, kid: keys.kid, typ: "JWT" })
      .setIssuer(launch.clientId)
      .setAudience(launch.iss)
      .setIssuedAt()
      .setExpirationTime("5m")
      .setJti(randomUrlSafe(16))
      .sign(keys.privateKey);

    return htmlResponse(renderAutoPostPage(launch.deepLinkReturnUrl, responseJwt));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return htmlResponse(renderErrorPage("LTI Deep Link Error", message), 400);
  }
}

async function handleConfig(request: Request, env: Env): Promise<Response> {
  try {
    const baseUrl = getToolBaseUrl(request, env);
    const host = new URL(baseUrl).hostname;
    const keys = await getToolKeys(env);
    const title = getTitle(env);
    const description = getDescription(env);
    const launchUrl = `${baseUrl}/lti/launch`;
    const loginUrl = `${baseUrl}/lti/login`;
    const iconUrl = `${baseUrl}/lti/icon.svg`;

    const clientId = getRequiredEnv(env.LTI_TOOL_CLIENT_ID, "LTI_TOOL_CLIENT_ID");

    return jsonResponse({
      title,
      description,
      target_link_uri: launchUrl,
      oidc_initiation_url: loginUrl,
      redirect_uris: [launchUrl],
      domain: host,
      tool_id: "reveal-answer",
      privacy_level: "public",
      public_jwk_url: `${baseUrl}/.well-known/jwks.json`,
      placements: [
        {
          placement: "editor_button",
          enabled: true,
          message_type: "LtiDeepLinkingRequest",
          target_link_uri: launchUrl,
          text: title,
          icon_url: iconUrl,
          selection_width: 860,
          selection_height: 700
        }
      ]
    });


  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: message }, 500);
  }
}

async function handleJwks(env: Env): Promise<Response> {
  try {
    const keys = await getToolKeys(env);
    return jsonResponse({ keys: [keys.publicJwk] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: message }, 500);
  }
}

function handleIcon(): Response {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Reveal Answer">
  <rect x="4" y="4" width="56" height="56" rx="12" fill="#111827"/>
  <rect x="12" y="18" width="40" height="8" rx="4" fill="#ffffff"/>
  <rect x="12" y="30" width="24" height="8" rx="4" fill="#9ca3af"/>
  <rect x="12" y="42" width="16" height="8" rx="4" fill="#4b5563"/>
</svg>`;
  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
}

function handleLtiInfo(request: Request, env: Env): Response {
  const baseUrl = getToolBaseUrl(request, env);
  return jsonResponse({
    status: "ok",
    tool: getTitle(env),
    configUrl: `${baseUrl}/lti/config`,
    jwksUrl: `${baseUrl}/.well-known/jwks.json`,
    loginUrl: `${baseUrl}/lti/login`,
    launchUrl: `${baseUrl}/lti/launch`
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/lti/login") {
      return handleLogin(request, env);
    }
    if (url.pathname === "/lti/launch") {
      return handleLaunch(request, env);
    }
    if (url.pathname === "/lti/deep-link") {
      return handleDeepLinkSubmit(request, env);
    }
    if (url.pathname === "/lti/config") {
      return handleConfig(request, env);
    }
    if (url.pathname === "/.well-known/jwks.json") {
      return handleJwks(env);
    }
    if (url.pathname === "/lti/icon.svg") {
      return handleIcon();
    }
    if (url.pathname === "/lti" || url.pathname === "/lti/health") {
      return handleLtiInfo(request, env);
    }

    return jsonResponse({ error: "Not found" }, 404);
  }
};
