# emma-mcp — Cloud Launchpad

**Showcases track pitch:** one natural-language compute request, compared across emma-connected clouds, followed by an explicit approval and a real provision request. The shortlist and the launch both go through emma; the exact offer is signed into a short-lived plan so the reviewed configuration is the one that gets created.

The project contains two surfaces that share one TypeScript core:

1. **Launchpad web app** — prompt → live cross-cloud shortlist → review → provision → SSH-ready result.
2. **MCP server** — read-only search/list tools plus a confirmation-gated provisioning tool for any MCP client.

The web app is a fast intent compiler, not a hidden LLM call. It extracts minimum CPU/RAM/storage, region and hourly budget locally; emma supplies the live catalog, connected providers and infrastructure operations. An MCP host can use its own model to formulate the prompt and select tools.

## Quick start

Requirements: Node.js 20.9+.

```bash
npm install
cp .env.example .env.local
# Fill in EMMA_CLIENT_ID and EMMA_CLIENT_SECRET for live mode.
npm run dev
```

Open <http://localhost:3000>. Without credentials, the app runs in **Preview data** mode: it uses a small, clearly labeled sample catalog and simulates a result using the reserved documentation IP `203.0.113.42`. It never calls emma or creates a cloud resource in preview mode. Set `EMMA_DEMO_MODE=false` to disable that fallback.

## Connect emma

1. In your emma project, create a **Service App** under **Settings → Service Apps**. Use **Manage** scope for provisioning (Read scope is enough for catalog reads but cannot create VMs).
2. Put the Client ID and Client Secret in `.env.local` (local) or server-side environment variables in your deployment. Do **not** use `NEXT_PUBLIC_*` variables or commit secrets.
3. Set `PLAN_SIGNING_SECRET` and `APP_SESSION_SECRET` to long random values, for example `openssl rand -base64 36`. Set a separate strong `APP_PASSWORD` for the web launchpad; live API routes remain locked until the workspace owner unlocks the HttpOnly, same-site session.
4. Restart the app. Unlock the page with `APP_PASSWORD`; the header should change to **emma connected** and show the live provider count. Search results will be from your project’s live catalog.
5. Import an OpenSSH **public** key in the launch panel if the Service App does not already have an SSH key visible to it. The private key stays on your machine.

The app issues and refreshes emma API access tokens server-side using the Service App credentials. A direct `EMMA_TOKEN` or `EMMA_ACCESS_TOKEN` can be used for short-lived testing; Client ID + Secret is preferred because emma access tokens expire.

## 90-second showcase run

Suggested prompt:

> Find a 4-core, 16 GB VM in Europe for under $0.05/hr — I want to run a Python service.

1. Click **Find my best match**. The compiler turns the ask into hard requirements; the app queries emma’s current VM configurations and location catalog.
2. Compare the ranked provider/location/cost rows. Select a match; the side panel shows the exact CPU, memory, disk, network and estimated provider cost.
3. Choose or import the SSH public key, then click **Review launch**. The confirmation screen repeats the exact offer and calls out cost exposure.
4. Tick the confirmation and choose **Create VM through emma**. The signed plan prevents a browser edit from changing the selected provider or configuration.
5. Show the returned emma resource ID/status and copyable SSH command. Provisioning time is controlled by emma and the selected cloud provider; allow time for the provider to finish.

**For a recording:** use credentials and a connected provider with an available SSH key before recording. Preview mode is useful for rehearsing but is explicitly simulated and does not satisfy the live-provision requirement.

## MCP server

The MCP server uses stdio. It shares the same server-side emma credentials and plan signer.

```bash
npm run mcp
```

Example Claude Desktop configuration (replace paths and inject secrets through your local secret manager/environment):

```json
{
  "mcpServers": {
    "emma-mcp": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/emma-mcp/mcp/server.ts"],
      "env": {
        "EMMA_CLIENT_ID": "YOUR_CLIENT_ID",
        "EMMA_CLIENT_SECRET": "YOUR_CLIENT_SECRET",
        "PLAN_SIGNING_SECRET": "YOUR_LONG_RANDOM_SECRET"
      }
    }
  }
}
```

Tools:

- `search_compute({ prompt })` — parse a request and return live matches, each with a three-minute signed plan token. Read-only.
- `list_ssh_keys({})` — list SSH key IDs visible to the Service App. Read-only.
- `list_vms({})` — list current project VMs. Read-only.
- `provision_vm({ planToken, sshKeyId, name, confirmed })` — create the exact VM from a valid live plan. **The MCP host must show the provider, region, size and cost and obtain explicit user approval before calling with `confirmed: true`.**

## API and safety notes

- Credentials only exist on the server; the browser never receives emma tokens or client secrets.
- Live browser/API routes require `APP_PASSWORD`; the session is an eight-hour, HttpOnly, same-site signed cookie. The stdio MCP server is intended for the local MCP client that launches it.
- The app uses emma’s External Infrastructure API: `/v1/issue-token`, `/v1/refresh-token`, `/v1/vms-configs`, `/v1/locations`, `/v1/providers`, `/v1/ssh-keys`, and `/v1/vms`.
- Search is read-only. Creating a VM requires a separate user confirmation in the web app or an explicit MCP confirmation call.
- The plan payload is HMAC-signed and expires after three minutes. It binds the selected provider, data center, OS, resource size, network type and pricing snapshot; provisioning does not trust a client-edited offer object.
- Price filtering uses emma’s provider-reported currency and price period. Non-comparable currencies or unknown periods are not treated as budget matches. Estimates can change before a cloud provider accepts the request.
- The app imports public SSH keys only; it rejects private-key formats.
- Use a dedicated project Service App with least privilege. A **Manage** token can create and delete real infrastructure, so protect it and rotate it if exposed.

## Commands

```bash
npm run dev       # local UI
npm run build     # production build
npm run start     # production server
npm run mcp       # stdio MCP server
npm test          # unit tests
npm run typecheck # TypeScript check
```

## Deploy

Deploy the repository as a Next.js app (for example on Vercel). Add `EMMA_CLIENT_ID`, `EMMA_CLIENT_SECRET`, `PLAN_SIGNING_SECRET`, `APP_PASSWORD`, and `APP_SESSION_SECRET` as **server-only** environment variables. The app refuses live control access until the launch password is configured. The `/api/provision` route declares a 300-second maximum duration; platform plan limits may impose a lower ceiling. Keep `EMMA_DEMO_MODE` enabled only if you want an explicit preview fallback.

## References

- [emma Infrastructure API quickstart](https://docs.emma.ms/docs/platform/integrations/developer-api/)
- [emma VM creation workflow](https://docs.emma.ms/docs/platform/project-services/vms/create-virtual-machine/)
- [emma MCP server setup](https://docs.emma.ms/docs/ai-console/mcp/mcp-server/)
- [emma MCP tools reference](https://docs.emma.ms/docs/ai-console/mcp/tools-reference/)
- [Official emma C# SDK API/model reference](https://github.com/emma-community/emma-csharp-sdk)

## License

MIT
