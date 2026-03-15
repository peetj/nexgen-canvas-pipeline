# Canvas External App: Reveal Answer (LTI 1.3)

This repo now includes an installable LTI 1.3 tool inside `agent/` for Canvas External Apps.

It is exposed from the worker at:
- `GET /lti/config` (Canvas Developer Key JSON)
- `GET /.well-known/jwks.json` (public JWKS)
- `GET|POST /lti/login` (OIDC initiation endpoint)
- `POST /lti/launch` (LTI launch endpoint)
- `POST /lti/deep-link` (returns deep-link content to Canvas)

The tool supports `editor_button` placement and inserts reveal-answer HTML into Canvas pages.

## 1) Generate signing keys

From repo root:

```bash
npm run -w nexgen-canvas-agent gen:lti-keys
```

Copy the generated values:
- `LTI_TOOL_PRIVATE_JWK`
- `LTI_TOOL_PUBLIC_JWK` (optional, can be derived from private key)
- `LTI_STATE_SECRET`

## 2) Configure worker secrets/vars

Set required values before deploy:

```bash
cd agent
wrangler secret put LTI_TOOL_PRIVATE_JWK
wrangler secret put LTI_STATE_SECRET
```

Set vars in `agent/wrangler.toml`:
- `LTI_TOOL_CLIENT_ID`: Canvas Developer Key client ID (set after key creation, then redeploy)
- `LTI_TOOL_KID`: must match your JWK `kid`
- `LTI_ALLOWED_ISSUERS`: comma-separated Canvas issuers
- `LTI_TOOL_TITLE`, `LTI_TOOL_DESCRIPTION`
- optional `LTI_TOOL_BASE_URL` if using a custom domain/proxy

## 3) Deploy worker

```bash
cd agent
npm run deploy
```

After deploy, note your tool URL:
- `https://<your-worker>.workers.dev`

## 4) Create Developer Key in Canvas (Admin)

1. Open Canvas `Admin` -> account -> `Developer Keys`.
2. Create new `LTI Key`.
3. Use one of:
   - **Enter URL**: `https://<your-worker>.workers.dev/lti/config`
   - **Paste JSON**: copy output from the same URL.
4. Save and set key to `ON`.
5. Copy the generated **Client ID**.

## 5) Finalize tool client id and redeploy

Set `LTI_TOOL_CLIENT_ID` in `agent/wrangler.toml` to that Canvas client ID, then deploy again:

```bash
cd agent
npm run deploy
```

## 6) Install as External App (course or account)

1. Canvas `Admin` or course `Settings` -> `Apps`.
2. `View App Configurations` -> `+ App`.
3. Configuration Type: `By Client ID`.
4. Paste the Client ID and install.

## 7) Use inside a Canvas page

1. Open a page and click `Edit`.
2. In the rich content editor, click the Apps plug icon.
3. Choose `Nexgen Reveal Answer`.
4. Fill question/answer and styling fields, then click `Insert into Canvas`.
5. Save page.

## Notes

- `basic` mode is safest for strict HTML sanitizers.
- `enhanced` mode uses a small `<style>` block for open/close icon and pill state swap.
- Use `Advanced Args JSON` in the selector UI to override any supported reveal arg.
