import { createRemoteJWKSet, jwtVerify } from "jose";

const CLAIM_MESSAGE_TYPE = "https://purl.imsglobal.org/spec/lti/claim/message_type";
const CLAIM_DEPLOYMENT_ID = "https://purl.imsglobal.org/spec/lti/claim/deployment_id";
const CLAIM_CONTEXT = "https://purl.imsglobal.org/spec/lti/claim/context";
const CLAIM_RESOURCE_LINK = "https://purl.imsglobal.org/spec/lti/claim/resource_link";
const CLAIM_CUSTOM = "https://purl.imsglobal.org/spec/lti/claim/custom";

const SESSION_TTL_SECONDS = 10 * 60;
const CLOCK_SKEW_SECONDS = 30;
const DEFAULT_PLACEHOLDER =
  "Write what you learned, what was challenging, and what you would do differently next time.";

type D1PreparedStatementLike = {
  bind: (...values: unknown[]) => {
    first: <T = Record<string, unknown>>() => Promise<T | null>;
    run: () => Promise<unknown>;
  };
};

type D1DatabaseLike = {
  prepare: (query: string) => D1PreparedStatementLike;
};

type Env = {
  REFLECTION_LTI_CLIENT_ID?: string;
  REFLECTION_LTI_BASE_URL?: string;
  REFLECTION_LTI_TITLE?: string;
  REFLECTION_LTI_DESCRIPTION?: string;
  LTI_TOOL_PRIVATE_JWK?: string;
  LTI_TOOL_PUBLIC_JWK?: string;
  LTI_TOOL_KID?: string;
  LTI_STATE_SECRET?: string;
  LTI_ALLOWED_ISSUERS?: string;
  LTI_TOOL_BASE_URL?: string;
  REFLECTIONS_DB?: D1DatabaseLike;
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

type ReflectionLaunchToken = {
  v: 1;
  iss: string;
  clientId: string;
  deploymentId: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  contextId?: string;
  contextTitle?: string;
  resourceLinkId?: string;
  resourceLinkTitle?: string;
  questionId: string;
  questionText: string;
  taskId?: string;
  taskTitle?: string;
  sessionId?: string;
  sessionTitle?: string;
  iat: number;
  exp: number;
};

type ResourceLaunchClaims = {
  iss: string;
  sub: string;
  nonce?: string;
  name?: string;
  email?: string;
  [CLAIM_MESSAGE_TYPE]?: string;
  [CLAIM_DEPLOYMENT_ID]?: unknown;
  [CLAIM_CONTEXT]?: unknown;
  [CLAIM_RESOURCE_LINK]?: unknown;
  [CLAIM_CUSTOM]?: unknown;
};

type SavedReflection = {
  answerText: string;
  updatedAt: string;
};

type ReflectionMetadata = {
  questionId: string;
  questionText: string;
  taskId?: string;
  taskTitle?: string;
  sessionId?: string;
  sessionTitle?: string;
};

const encoder = new TextEncoder();
const openIdConfigCache = new Map<string, { config: OpenIdConfig; expiresAt: number }>();

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

function randomUrlSafe(length = 24): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
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

async function signPayload(secret: string, payload: StatePayload | ReflectionLaunchToken): Promise<string> {
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

function getClientId(env: Env): string {
  return getRequiredEnv(env.REFLECTION_LTI_CLIENT_ID, "REFLECTION_LTI_CLIENT_ID");
}

function getToolBaseUrl(request: Request, env: Env): string {
  const configured = env.REFLECTION_LTI_BASE_URL?.trim() || env.LTI_TOOL_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  return new URL(request.url).origin.replace(/\/+$/, "");
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

function parseJson<T>(raw: string, envName: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${envName} is not valid JSON.`);
  }
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

function getPublicJwk(env: Env): JsonWebKey {
  const privateJwkJson = getRequiredEnv(env.LTI_TOOL_PRIVATE_JWK, "LTI_TOOL_PRIVATE_JWK");
  const explicitPublic = env.LTI_TOOL_PUBLIC_JWK?.trim();
  const kid = env.LTI_TOOL_KID?.trim() || "reflection-question-key";

  if (explicitPublic) {
    const publicJwk = parseJson<JsonWebKey>(explicitPublic, "LTI_TOOL_PUBLIC_JWK");
    const alg = typeof publicJwk.alg === "string" && publicJwk.alg.trim() ? publicJwk.alg : "RS256";
    return {
      ...publicJwk,
      alg,
      kid,
      use: "sig"
    };
  }

  const privateJwk = parseJson<JsonWebKey>(privateJwkJson, "LTI_TOOL_PRIVATE_JWK");
  const alg = typeof privateJwk.alg === "string" && privateJwk.alg.trim() ? privateJwk.alg : "RS256";
  return derivePublicJwk(privateJwk, kid, alg);
}

function getDb(env: Env): D1DatabaseLike {
  if (!env.REFLECTIONS_DB) {
    throw new Error("Missing D1 binding: REFLECTIONS_DB");
  }
  return env.REFLECTIONS_DB;
}

function getTitle(env: Env): string {
  return env.REFLECTION_LTI_TITLE?.trim() || "Nexgen Reflection Question";
}

function getDescription(env: Env): string {
  return (
    env.REFLECTION_LTI_DESCRIPTION?.trim() ||
    "Collect student reflections for a task and save them per learner."
  );
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

function renderReflectionPage(input: {
  appTitle: string;
  launchToken: string;
  questionText: string;
  answerText: string;
  savedNotice?: string;
  sessionTitle?: string;
  taskTitle?: string;
  userName?: string;
}): string {
  const badges = [input.sessionTitle, input.taskTitle].filter((value): value is string => Boolean(value?.trim()));
  const savedBlock = input.savedNotice
    ? `<div class="notice">${htmlEscape(input.savedNotice)}</div>`
    : "";
  const metaBlock = badges.length > 0
    ? `<div class="meta">${badges.map((item) => `<span>${htmlEscape(item)}</span>`).join("")}</div>`
    : "";
  const greeting = input.userName?.trim()
    ? `<p class="greeting">Reflection for ${htmlEscape(input.userName.trim())}</p>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${htmlEscape(input.appTitle)}</title>
    <style>
      :root {
        --bg: #eef3f8;
        --card: #ffffff;
        --text: #13233b;
        --muted: #516071;
        --line: #d7e0ea;
        --accent: #1f5fbf;
        --accent-strong: #173d76;
        --notice-bg: #e9f4ea;
        --notice-text: #17552f;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(31,95,191,0.08), transparent 28%),
          linear-gradient(180deg, #f6f9fc 0%, var(--bg) 100%);
      }
      main {
        max-width: 760px;
        margin: 0 auto;
        padding: 28px 16px 40px;
      }
      .card {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 18px;
        box-shadow: 0 18px 50px rgba(12, 25, 45, 0.08);
        padding: 22px;
      }
      h1 {
        margin: 0;
        font-size: 24px;
        line-height: 1.2;
      }
      .greeting {
        margin: 8px 0 0;
        color: var(--muted);
        font-size: 14px;
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 14px 0 0;
      }
      .meta span {
        border: 1px solid var(--line);
        background: #f7fafd;
        border-radius: 999px;
        padding: 6px 10px;
        font-size: 12px;
        color: var(--accent-strong);
      }
      .notice {
        margin: 18px 0 0;
        background: var(--notice-bg);
        color: var(--notice-text);
        border: 1px solid rgba(23, 85, 47, 0.12);
        border-radius: 12px;
        padding: 10px 12px;
        font-size: 14px;
      }
      form {
        margin-top: 18px;
      }
      label {
        display: block;
        margin-bottom: 10px;
        font-size: 15px;
        font-weight: 700;
        line-height: 1.45;
      }
      textarea {
        width: 100%;
        min-height: 180px;
        resize: vertical;
        border: 1px solid #c8d3e0;
        border-radius: 14px;
        padding: 14px;
        font: inherit;
        line-height: 1.5;
        color: var(--text);
        background: #fbfdff;
      }
      textarea:focus {
        outline: 2px solid rgba(31,95,191,0.18);
        border-color: var(--accent);
      }
      .hint {
        margin: 10px 0 0;
        font-size: 13px;
        color: var(--muted);
      }
      .actions {
        margin-top: 16px;
      }
      button {
        appearance: none;
        border: 1px solid transparent;
        border-radius: 10px;
        background: var(--accent);
        color: #fff;
        font: inherit;
        font-weight: 700;
        padding: 10px 16px;
        cursor: pointer;
      }
      button:hover {
        background: var(--accent-strong);
      }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <h1>${htmlEscape(input.appTitle)}</h1>
        ${greeting}
        ${metaBlock}
        ${savedBlock}
        <form method="post" action="/reflection/respond">
          <input type="hidden" name="launch_token" value="${htmlEscape(input.launchToken)}">
          <label for="answer">${htmlEscape(input.questionText)}</label>
          <textarea
            id="answer"
            name="answer"
            required
            placeholder="${htmlEscape(DEFAULT_PLACEHOLDER)}"
          >${htmlEscape(input.answerText)}</textarea>
          <p class="hint">Your reflection is saved to your learner record for this task and question.</p>
          <div class="actions">
            <button type="submit">Save reflection</button>
          </div>
        </form>
      </section>
    </main>
  </body>
</html>`;
}

function firstNonEmpty(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function parseStringRecord(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
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

function normalizeKey(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "reflection";
}

function getContextDetails(claims: ResourceLaunchClaims): { id?: string; title?: string } {
  const context = claims[CLAIM_CONTEXT];
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return {};
  }
  const record = context as Record<string, unknown>;
  return {
    id: firstNonEmpty(record.id),
    title: firstNonEmpty(record.title, record.label)
  };
}

function getResourceLinkDetails(claims: ResourceLaunchClaims): { id?: string; title?: string } {
  const resourceLink = claims[CLAIM_RESOURCE_LINK];
  if (!resourceLink || typeof resourceLink !== "object" || Array.isArray(resourceLink)) {
    return {};
  }
  const record = resourceLink as Record<string, unknown>;
  return {
    id: firstNonEmpty(record.id),
    title: firstNonEmpty(record.title, record.description)
  };
}

function resolveMetadata(claims: ResourceLaunchClaims): ReflectionMetadata {
  const custom = parseStringRecord(claims[CLAIM_CUSTOM]);
  const context = getContextDetails(claims);
  const resourceLink = getResourceLinkDetails(claims);

  const questionText =
    firstNonEmpty(
      custom.reflection_question,
      custom.question,
      custom.prompt,
      custom.reflection_prompt,
      resourceLink.title
    ) || "What did you learn from this task?";
  const questionId = normalizeKey(
    firstNonEmpty(custom.question_id, custom.reflection_id, custom.prompt_id, questionText) || questionText
  );

  return {
    questionId,
    questionText,
    taskId: firstNonEmpty(custom.task_id, custom.task_key),
    taskTitle: firstNonEmpty(custom.task_title, custom.task, resourceLink.title),
    sessionId: firstNonEmpty(custom.session_id, custom.session_key, context.id),
    sessionTitle: firstNonEmpty(custom.session_title, custom.session, context.title)
  };
}

function buildIdentityKey(token: ReflectionLaunchToken): string {
  return [
    token.iss,
    token.clientId,
    token.deploymentId,
    token.contextId ?? "no-context",
    token.resourceLinkId ?? "no-resource",
    token.userId,
    token.questionId
  ].join("::");
}

async function loadSavedReflection(
  db: D1DatabaseLike,
  identityKey: string
): Promise<SavedReflection | undefined> {
  const row = await db
    .prepare(
      `SELECT answer_text as answerText, updated_at as updatedAt
       FROM reflection_responses
       WHERE identity_key = ?1
       LIMIT 1`
    )
    .bind(identityKey)
    .first<SavedReflection>();

  return row ?? undefined;
}

async function saveReflection(db: D1DatabaseLike, token: ReflectionLaunchToken, answerText: string): Promise<string> {
  const nowIso = new Date().toISOString();
  const identityKey = buildIdentityKey(token);

  await db
    .prepare(
      `INSERT INTO reflection_responses (
        id,
        identity_key,
        issuer,
        client_id,
        deployment_id,
        canvas_user_id,
        canvas_user_name,
        canvas_user_email,
        context_id,
        context_title,
        resource_link_id,
        resource_link_title,
        session_id,
        session_title,
        task_id,
        task_title,
        question_id,
        question_text,
        answer_text,
        created_at,
        updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)
      ON CONFLICT(identity_key) DO UPDATE SET
        canvas_user_name = excluded.canvas_user_name,
        canvas_user_email = excluded.canvas_user_email,
        context_title = excluded.context_title,
        resource_link_title = excluded.resource_link_title,
        session_id = excluded.session_id,
        session_title = excluded.session_title,
        task_id = excluded.task_id,
        task_title = excluded.task_title,
        question_text = excluded.question_text,
        answer_text = excluded.answer_text,
        updated_at = excluded.updated_at`
    )
    .bind(
      randomUrlSafe(18),
      identityKey,
      token.iss,
      token.clientId,
      token.deploymentId,
      token.userId,
      token.userName ?? null,
      token.userEmail ?? null,
      token.contextId ?? null,
      token.contextTitle ?? null,
      token.resourceLinkId ?? null,
      token.resourceLinkTitle ?? null,
      token.sessionId ?? null,
      token.sessionTitle ?? null,
      token.taskId ?? null,
      token.taskTitle ?? null,
      token.questionId,
      token.questionText,
      answerText,
      nowIso,
      nowIso
    )
    .run();

  return nowIso;
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const params = await parseRequestParams(request);
  const issuer = params.get("iss")?.trim();
  const loginHint = params.get("login_hint")?.trim();
  const messageHint = params.get("lti_message_hint")?.trim();
  const targetLinkUri = params.get("target_link_uri")?.trim();
  const requestedClientId = params.get("client_id")?.trim();

  if (!issuer || !loginHint || !targetLinkUri) {
    return htmlResponse(renderErrorPage("Reflection Login Error", "Missing required OIDC login params."), 400);
  }

  try {
    ensureIssuerAllowed(issuer, env);
    const clientId = getClientId(env);
    if (requestedClientId && requestedClientId !== clientId) {
      return htmlResponse(
        renderErrorPage("Reflection Login Error", `Unexpected client_id. Expected ${clientId}.`),
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
    return htmlResponse(renderErrorPage("Reflection Login Error", message), 400);
  }
}

async function verifyLaunch(request: Request, env: Env): Promise<ReflectionLaunchToken> {
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

  const claims = payload as unknown as ResourceLaunchClaims;
  if (claims.nonce !== state.nonce) {
    throw new Error("Nonce mismatch.");
  }
  if (claims[CLAIM_MESSAGE_TYPE] !== "LtiResourceLinkRequest") {
    throw new Error(`Unsupported launch message type: ${String(claims[CLAIM_MESSAGE_TYPE] ?? "")}`);
  }

  const deploymentId = typeof claims[CLAIM_DEPLOYMENT_ID] === "string"
    ? claims[CLAIM_DEPLOYMENT_ID]
    : "";
  if (!deploymentId) {
    throw new Error("Missing deployment id claim.");
  }
  if (!claims.sub?.trim()) {
    throw new Error("Missing learner identifier in launch.");
  }

  const context = getContextDetails(claims);
  const resourceLink = getResourceLinkDetails(claims);
  const metadata = resolveMetadata(claims);
  const now = nowEpochSeconds();

  return {
    v: 1,
    iss: claims.iss,
    clientId: state.clientId,
    deploymentId,
    userId: claims.sub.trim(),
    userName: firstNonEmpty(claims.name),
    userEmail: firstNonEmpty(claims.email),
    contextId: context.id,
    contextTitle: context.title,
    resourceLinkId: resourceLink.id,
    resourceLinkTitle: resourceLink.title,
    questionId: metadata.questionId,
    questionText: metadata.questionText,
    taskId: metadata.taskId,
    taskTitle: metadata.taskTitle,
    sessionId: metadata.sessionId,
    sessionTitle: metadata.sessionTitle,
    iat: now,
    exp: now + SESSION_TTL_SECONDS
  };
}

async function handleLaunch(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return htmlResponse(renderErrorPage("Reflection Launch Error", "Launch endpoint requires POST."), 405);
  }

  try {
    const db = getDb(env);
    const launch = await verifyLaunch(request, env);
    const stateSecret = getRequiredEnv(env.LTI_STATE_SECRET, "LTI_STATE_SECRET");
    const launchToken = await signPayload(stateSecret, launch);
    const existing = await loadSavedReflection(db, buildIdentityKey(launch));

    return htmlResponse(
      renderReflectionPage({
        appTitle: getTitle(env),
        launchToken,
        questionText: launch.questionText,
        answerText: existing?.answerText ?? "",
        sessionTitle: launch.sessionTitle,
        taskTitle: launch.taskTitle,
        userName: launch.userName,
        savedNotice: existing?.updatedAt ? `Previously saved on ${existing.updatedAt}.` : undefined
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return htmlResponse(renderErrorPage("Reflection Launch Error", message), 400);
  }
}

async function handleResponse(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return htmlResponse(renderErrorPage("Reflection Save Error", "Endpoint requires POST."), 405);
  }

  try {
    const db = getDb(env);
    const form = await request.formData();
    const launchTokenRaw = form.get("launch_token");
    const answerRaw = form.get("answer");
    if (typeof launchTokenRaw !== "string" || !launchTokenRaw.trim()) {
      throw new Error("Missing launch token.");
    }
    if (typeof answerRaw !== "string" || !answerRaw.trim()) {
      throw new Error("Reflection answer is required.");
    }

    const stateSecret = getRequiredEnv(env.LTI_STATE_SECRET, "LTI_STATE_SECRET");
    const token = await verifySignedPayload<ReflectionLaunchToken>(launchTokenRaw, stateSecret);
    const answerText = answerRaw.trim();
    const savedAt = await saveReflection(db, token, answerText);

    return htmlResponse(
      renderReflectionPage({
        appTitle: getTitle(env),
        launchToken: launchTokenRaw,
        questionText: token.questionText,
        answerText,
        sessionTitle: token.sessionTitle,
        taskTitle: token.taskTitle,
        userName: token.userName,
        savedNotice: `Reflection saved on ${savedAt}.`
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return htmlResponse(renderErrorPage("Reflection Save Error", message), 400);
  }
}

async function handleConfig(request: Request, env: Env): Promise<Response> {
  try {
    const baseUrl = getToolBaseUrl(request, env);
    const host = new URL(baseUrl).hostname;
    const title = getTitle(env);
    const description = getDescription(env);
    const launchUrl = `${baseUrl}/reflection/launch`;
    const loginUrl = `${baseUrl}/reflection/login`;
    const iconUrl = `${baseUrl}/reflection/icon.svg`;

    return jsonResponse({
      title,
      description,
      target_link_uri: launchUrl,
      oidc_initiation_url: loginUrl,
      redirect_uris: [launchUrl],
      domain: host,
      tool_id: "reflection-question",
      privacy_level: "public",
      public_jwk_url: `${baseUrl}/.well-known/reflection-jwks.json`
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: message }, 500);
  }
}

async function handleJwks(env: Env): Promise<Response> {
  try {
    return jsonResponse({ keys: [getPublicJwk(env)] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: message }, 500);
  }
}

function handleIcon(): Response {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Reflection Question">
  <rect x="4" y="4" width="56" height="56" rx="12" fill="#1f5fbf"/>
  <rect x="14" y="14" width="36" height="30" rx="8" fill="#ffffff"/>
  <rect x="20" y="22" width="24" height="4" rx="2" fill="#1f5fbf"/>
  <rect x="20" y="30" width="20" height="4" rx="2" fill="#86a8de"/>
  <path d="M24 50h16" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
</svg>`;
  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
}

function handleInfo(request: Request, env: Env): Response {
  const baseUrl = getToolBaseUrl(request, env);
  return jsonResponse({
    status: "ok",
    tool: getTitle(env),
    configUrl: `${baseUrl}/reflection/config`,
    jwksUrl: `${baseUrl}/.well-known/reflection-jwks.json`,
    loginUrl: `${baseUrl}/reflection/login`,
    launchUrl: `${baseUrl}/reflection/launch`,
    responseUrl: `${baseUrl}/reflection/respond`
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/reflection/login") {
      return handleLogin(request, env);
    }
    if (url.pathname === "/reflection/launch") {
      return handleLaunch(request, env);
    }
    if (url.pathname === "/reflection/respond") {
      return handleResponse(request, env);
    }
    if (url.pathname === "/reflection/config") {
      return handleConfig(request, env);
    }
    if (url.pathname === "/.well-known/reflection-jwks.json") {
      return handleJwks(env);
    }
    if (url.pathname === "/reflection/icon.svg") {
      return handleIcon();
    }
    if (url.pathname === "/reflection" || url.pathname === "/reflection/health") {
      return handleInfo(request, env);
    }

    return jsonResponse({ error: "Not found" }, 404);
  }
};
