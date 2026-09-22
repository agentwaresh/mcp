# Agentware MCP

The MCP server for [Agentware](https://agentware.sh), the marketplace for software and inference for agents on Robinhood Chain. Give any MCP client the library and the models: browse packages, read scan reports, buy with USDG through x402, and pay per call for inference. No account, no API key. Payment is the authentication.

## Install

```bash
npx @agentwaresh/mcp
```

Or from source:

```bash
git clone git@github.com:agentwaresh/mcp.git
cd mcp
npm install
npm run build
node dist/index.js
```

## Configure a client

Claude Desktop, Claude Code, Cursor and every other MCP client take the same shape.

```json
{
  "mcpServers": {
    "agentware": {
      "command": "npx",
      "args": ["-y", "@agentwaresh/mcp"],
      "env": {
        "AGENT_KEY": "0xyourprivatekey",
        "SPEND_CAP_USDG": "5"
      }
    }
  }
}
```

Claude Code:

```bash
claude mcp add agentware -e AGENT_KEY=0xyourprivatekey -- npx -y @agentwaresh/mcp
```

Leave `AGENT_KEY` out and the free tools still work. The paid tools need it.

| Variable | Meaning | Default |
| --- | --- | --- |
| `AGENT_KEY` | Private key of the agent wallet on Robinhood Chain (chain id 4663). It holds USDG and, once, a little ETH | none |
| `SPEND_CAP_USDG` | The most a single payment may sign for | `5` |
| `AGENTWARE_API` | API base URL | `https://agentware.sh/api` |

Use a dedicated wallet that holds only what the agent is allowed to spend.

## Tools

| Tool | Cost | What it does |
| --- | --- | --- |
| `agent_guide` | Free | The whole agent guide as one JSON document |
| `list_packages` | Free | Live packages, filter by kind and category |
| `get_package` | Free | One package with its full scan report and reviews |
| `list_models` | Free | Models with endpoints and USDG prices per million tokens |
| `quote_purchase` | Free | The exact fee a purchase asks for, from the 402 terms |
| `quote_inference` | Free | The exact price of one model call |
| `wallet_status` | Free | Address, USDG and ETH balances, Permit2 approval, spend cap |
| `buy_package` | Package price | Pays the 10% fee, then the 90% to the seller, returns and optionally saves the package |
| `ask_model` | Per call | One chat completion, paid in USDG |

Kinds: `skill`, `prompt`, `mcp`, `workflow`, `code`.
Categories: `payments`, `onchain`, `research`, `coding`, `devops`, `data`, `content`, `security`, `other`.

## How a purchase works

1. `list_packages` to find one, `get_package` to read its scan report.
2. `quote_purchase` to see the exact terms. Nothing is charged.
3. `buy_package` signs two Permit2 witness transfers: 10% to the treasury, then 90% to the current owner of the package NFT. The second response holds the package body and the file name to save it as.

The first purchase sends one transaction to approve Permit2 for USDG. After that, buying costs no gas. A wallet can only buy a package once.

The server refuses to sign for a token other than USDG, for more than the listed price, or for more than the spend cap.

## How a model call works

`ask_model` posts the messages once, gets a 402 with the exact price for this request, signs it, and posts again. The price is the upper bound: estimated input plus the full `max_tokens` output budget. Keep `max_tokens` close to what you need. If the model fails after payment, the call is recorded for a refund.

## Safety

A scan lowers risk. It is not a guarantee. Read the scan report before buying, and review a package before your agent loads or runs it.

## Develop

```bash
npm install
npm run build
npm run smoke     # lists tools and calls the free endpoints over stdio
```

## License

MIT
