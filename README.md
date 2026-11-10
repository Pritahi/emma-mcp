# emma-mcp

**An open-source MCP server that gives any AI agent the keys to multi-cloud spot capacity.**

Built for the [emma Hackathon](https://hackathon.emma.ms/) (Showcases track).

## The idea

AI agents need compute, but every cloud speaks a different API. emma already unifies
11 providers and 23 GPU models behind one API. emma-mcp turns that API into
[MCP](https://modelcontextprotocol.io) tools so any agent can buy its own compute
with a sentence:

> "get me an 8-core 32GB spot box in Europe under $0.10/hr and run my benchmark"

The agent searches live spot offers across all providers, provisions the cheapest
match with cloud-init, runs the job over SSH, streams the result, and destroys the
VM. This could not exist on a single cloud: the point is cross-provider price
discovery through one agent-facing API.

## Demo (90 seconds, prompt to running result)

1. Prompt to the agent (Claude / any MCP client)
2. `search_spot_offers` - live-ranked table: region, provider, shape, $/hr
3. `provision_spot` - cheapest match, cloud-init injected, SSH key returned
4. Agent SSHes in, runs the benchmark, streams output
5. `destroy_instance` - VM gone, spend stops

## Tools

| Tool | What it does | emma API |
|---|---|---|
| `search_spot_offers` | Live spot configurations filtered by vCPU/RAM/GPU/region/max price, ranked cheapest-first | `GET /external/v1/spot-instances/configurations` |
| `provision_spot` | Create a spot instance from a chosen configuration + cloud-init | `POST /external/v1/spot-instances` |
| `instance_status` | Poll state + connection details | `GET /external/v1/spot-instances/{id}` |
| `destroy_instance` | Delete the instance | `DELETE /external/v1/spot-instances/{id}` |

## Setup

```bash
npm install
export EMMA_CLIENT_ID=...      # emma project -> Settings -> Service Apps
export EMMA_CLIENT_SECRET=...
npm run dev
```

Point your MCP client at the server, then ask for compute in plain language.

## Stack

TypeScript + [@emma-community/emma-typescript-sdk](https://github.com/emma-community/emma-typescript-sdk) + @modelcontextprotocol/sdk.
