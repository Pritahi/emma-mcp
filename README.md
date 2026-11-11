# emma-mcp — Cloud Launchpad

This repository contains two deliberately separate emma workflows:

1. **Launchpad web app** — the existing prompt → VM shortlist → review → provision experience. The web UI is unchanged by the MCP spot lifecycle work.
2. **MCP server** — search Linux spot offers, provision only after explicit approval, run a short SSH benchmark, inspect status, and destroy the spot instance through emma.

The MCP server uses emma's current spot catalog and project credentials. A short-lived signed offer token binds provisioning to the exact configuration the user reviewed. In live mode, a private SSH key matching the selected emma SSH key must be available to the MCP process. Preview mode is fully simulated.

## Quick start

Requirements: Node.js 20.9+.

```bash
npm install
cp .env.example .env.local
# Fill in EMMA_CLIENT_ID and EMMA_CLIENT_SECRET for live mode.
npm run dev
```

Open <http://localhost:3000>. Without credentials, the web app runs in **Preview data** mode: it uses a clearly labeled sample VM catalog and simulates a result with the reserved documentation IP `203.0.113.42`. It never calls emma or creates a cloud resource in preview mode. Set `EMMA_DEMO_MODE=false` to disable the fallback.

## Connect emma

1. In your emma project, create a **Service App** under **Settings → Service Apps**. Use **Manage** scope for live spot creation/deletion; it also permits the catalog and SSH-key reads. Use least privilege where your project supports finer-grained scopes.
2. Put the Client ID and Client Secret in `.env.local` (local) or server-side environment variables. Do **not** use `NEXT_PUBLIC_*` variables or commit secrets.
3. Set `PLAN_SIGNING_SECRET` and `APP_SESSION_SECRET` to long random values, for example `openssl rand -base64 36`. Set a separate strong `APP_PASSWORD` for the web launchpad; live web API routes remain locked until the workspace owner unlocks the HttpOnly, same-site session.
4. Restart the app. Unlock the page with `APP_PASSWORD`; the header should change to **emma connected**. The MCP stdio server does not use the web password/session.
5. For the MCP server, make sure the selected public SSH key is visible to the Service App. Configure the matching **private** key for the MCP process using `EMMA_SSH_PRIVATE_KEY_PATH`, or use an already loaded SSH agent (`SSH_AUTH_SOCK`). An encrypted key may use `EMMA_SSH_PRIVATE_KEY_PASSPHRASE`. The private key stays on the MCP host; never paste it into an MCP call or upload it to emma.

The app issues and refreshes emma API access tokens server-side using Service App credentials. A direct `EMMA_TOKEN` or `EMMA_ACCESS_TOKEN` can be used for short-lived testing; Client ID + Secret is preferred because emma access tokens expire.

## 90-second web showcase

The existing web flow still provisions regular VMs, not spot instances. Suggested prompt:

> Find a 4-core, 16 GB VM in Europe for under $0.05/hr — I want to run a Python service.

1. Click **Find my best match**. The compiler turns the ask into hard requirements; the app queries emma’s current VM configurations and location catalog.
2. Compare the ranked provider/location/cost rows. Select a match; the side panel shows CPU, memory, disk, network and estimated provider cost.
3. Choose or import the SSH public key, then click **Review launch**. The confirmation screen repeats the offer and calls out cost exposure.
4. Tick the confirmation and choose **Create VM through emma**. The signed plan prevents a browser edit from changing the selected configuration.
5. Show the returned emma resource ID/status and copyable SSH command.

Preview mode is useful for rehearsing but is explicitly simulated and does not create infrastructure.

## MCP spot lifecycle

The MCP server uses stdio:

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
        "PLAN_SIGNING_SECRET": "YOUR_LONG_RANDOM_SECRET",
        "EMMA_SSH_PRIVATE_KEY_PATH": "/absolute/path/to/id_ed25519"
      }
    }
  }
}
```

The server exposes **exactly four tools**:

- `search_spot_offers({ min_vcpu?, min_ram_gb?, min_gpu_count?, gpu_type?, region?, max_price_per_hour?, currency?, limit? })` — read-only live spot search, cheapest-first. Returns signed offer tokens and the SSH key IDs visible to emma. Only Linux offers are returned because the follow-up initialization and benchmark use bash/SSH. If a maximum hourly price is supplied without a currency, the search defaults to USD. No FX conversion is performed; without a currency filter, native-currency groups are ranked separately.
- `provision_spot({ offer_token, ssh_key_id, name?, init_script?, bid_price_per_hour?, security_group_id?, confirmed })` — creates the exact signed offer only when `confirmed: true`. Before calling, show the user the provider, location, CPU/GPU, RAM, storage, OS, hourly bid/currency, and selected SSH key, then obtain explicit approval. The server prepends a small `curl` bootstrap to the optional bash init script, waits for SSH, and runs three HTTPS request-timing checks from the instance to `example.com`.
- `instance_status({ instance_id })` — fetches current emma status and public/private IPs, with a copyable SSH command when available. Demo IDs are local to the MCP server process.
- `destroy_instance({ instance_id, confirmed })` — permanently deletes the named live spot instance (or removes a simulated demo record). Only call with `confirmed: true` after the user requests cleanup of that exact ID.

A successful `provision_spot` leaves the spot running and potentially billable; call `destroy_instance` when it is no longer needed. If the SSH benchmark fails, the server attempts to delete the newly created instance automatically. If that cleanup also fails, the error includes the instance ID and instructs the MCP host to call `destroy_instance` immediately. Spot capacity and prices can change; a spot instance can be interrupted under provider/emma market rules.

Without emma credentials, the server returns clearly labeled synthetic offers and a synthetic `demo-key-01`. The demo lifecycle and sample benchmark output are simulated: no emma request, SSH connection, benchmark, or cloud resource is used. Set `EMMA_DEMO_MODE=false` to disable this fallback. Live spot creation requires the private key matching the chosen `ssh_key_id` to be available through `EMMA_SSH_PRIVATE_KEY_PATH`, `EMMA_SSH_PRIVATE_KEY`, or `SSH_AUTH_SOCK`; if credentials are missing, the tool fails before creating a resource.

## API and safety notes

- emma credentials and the SSH private key stay server-side; they are never returned to the web browser or sent to emma's SSH-key API.
- The MCP uses emma's External Infrastructure API: `/v1/spots-configs`, `/v1/locations`, `/v1/ssh-keys`, and `/v1/spot-instances` (create, read, delete). The web UI separately uses the existing VM endpoints.
- Search is read-only. Live creation and deletion require separate `confirmed: true` calls; the MCP host must obtain user approval first.
- Spot offer tokens are HMAC-signed and expire after three minutes. They bind the selected offer, source mode and search price ceiling; provisioning does not trust a client-edited offer object.
- Prices are provider-reported. Unknown billing periods are excluded, currencies are not converted, and provider prices may change before a spot bid is accepted.
- The MCP sends a cloud-init `initScript`, supported by emma only for Linux spot OS IDs. It bootstraps `curl` only if needed; the SSH benchmark has connection and command timeouts.
- Use a dedicated emma Service App with the minimum required privilege. A **Manage** token can create and delete real infrastructure, so protect and rotate it if exposed.
- The web launchpad remains protected by its existing `APP_PASSWORD` and signed HttpOnly session cookie. The local stdio MCP process is intended to be launched by the MCP client.

## Commands

```bash
npm run dev       # web UI
npm run build     # production web build
npm run start     # production web server
npm run mcp       # stdio MCP server
npm test          # unit and MCP lifecycle tests
npm run typecheck # TypeScript check
```

## Deploy

Deploy the repository as a Next.js app (for example on Vercel) to host the existing web launchpad. Add `EMMA_CLIENT_ID`, `EMMA_CLIENT_SECRET`, `PLAN_SIGNING_SECRET`, `APP_PASSWORD`, and `APP_SESSION_SECRET` as **server-only** environment variables. The app refuses live web control access until the launch password is configured. The MCP server is a separate stdio process and needs its own emma credentials and SSH key/agent environment; do not expose a private key in a web deployment. The `/api/provision` route declares a 300-second maximum duration; platform plan limits may impose a lower ceiling.

## References

- [emma Infrastructure API quickstart](https://docs.emma.ms/docs/platform/integrations/developer-api/)
- [emma spot instance creation](https://docs.emma.ms/docs/platform/project-services/spot-instances/create-spot-instances/)
- [emma External Infrastructure API OpenAPI spec](https://api.emma.ms/external/v3/api-docs)
- [emma VM creation workflow](https://docs.emma.ms/docs/platform/project-services/vms/create-virtual-machine/)
- [emma MCP server setup](https://docs.emma.ms/docs/ai-console/mcp/mcp-server/)

## License

MIT
