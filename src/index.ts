#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { get } from "./api.js";
import { CATEGORIES, KINDS, SPEND_CAP_UNITS, toUsdg } from "./config.js";
import { ensureApproval, hasWallet, pay, quote, walletStatus } from "./wallet.js";

const server = new McpServer({ name: "agentware", version: "0.1.0" });

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const fail = (err: unknown) => ({ isError: true, content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }] });
const run = async (fn: () => Promise<unknown>) => {
  try {
    return json(await fn());
  } catch (err) {
    return fail(err);
  }
};

const walletNote = hasWallet() ? "" : " AGENT_KEY is not set, so this tool will fail until a wallet is configured.";

// Free tools

server.registerTool(
  "agent_guide",
  {
    title: "Agentware agent guide",
    description: "The whole Agentware guide for agents as one JSON document: network, token, kinds, categories, endpoints, payment flow and rules. Free.",
    inputSchema: {},
  },
  () => run(() => get("/agent")),
);

server.registerTool(
  "list_packages",
  {
    title: "List packages",
    description: "List live packages in the Agentware library, newest first, with price, scan score, reviews and sales. Filter by kind and category. Free.",
    inputSchema: {
      kind: z.enum(KINDS).optional().describe("skill, prompt, mcp, workflow or code"),
      category: z.enum(CATEGORIES).optional().describe("payments, onchain, research, coding, devops, data, content, security or other"),
      limit: z.number().int().min(1).max(200).optional().describe("How many to return. Default 25."),
    },
  },
  ({ kind, category, limit }) =>
    run(async () => {
      const { packages } = await get<{ packages: any[] }>("/packages", { kind, category });
      return { count: packages.length, packages: packages.slice(0, limit ?? 25) };
    }),
);

server.registerTool(
  "get_package",
  {
    title: "Get a package",
    description: "One package by slug: summary, price, the full scan report (verdict, score, issues) and onchain reviews. Read the scan before buying. Free.",
    inputSchema: { slug: z.string().min(1).describe("The package slug, from list_packages") },
  },
  ({ slug }) => run(() => get(`/packages/${encodeURIComponent(slug)}`)),
);

server.registerTool(
  "list_models",
  {
    title: "List inference models",
    description: "Models sold per call on Agentware, with their endpoints and USDG prices per million tokens. Free.",
    inputSchema: {},
  },
  () => run(() => get("/inference/models")),
);

server.registerTool(
  "quote_purchase",
  {
    title: "Quote a package purchase",
    description: "Ask what buying a package costs without paying. Returns the exact 10% platform fee from the 402 terms; the seller gets the remaining 90%. Free.",
    inputSchema: { packageId: z.number().int().positive().describe("The onchain packageId, from list_packages") },
  },
  ({ packageId }) =>
    run(async () => {
      const fee = await quote("/pay/treasury", { packageId });
      return { packageId, fee, note: "The fee is 10% of the price, rounded down. The seller payment is the remaining 90%." };
    }),
);

server.registerTool(
  "quote_inference",
  {
    title: "Quote a model call",
    description: "The exact USDG price of one model call for the given messages and max_tokens, without paying. Free.",
    inputSchema: {
      model: z.string().min(1).describe("Model key from list_models, for example claude-sonnet-5"),
      messages: z.array(z.object({ role: z.enum(["system", "user", "assistant", "tool"]), content: z.string() })).min(1).max(200),
      max_tokens: z.number().int().min(1).max(8192).optional().describe("Output budget you pay for. Default 2048."),
    },
  },
  ({ model, messages, max_tokens }) => run(() => quote(`/inference/${encodeURIComponent(model)}`, { messages, max_tokens })),
);

// Paid tools

server.registerTool(
  "wallet_status",
  {
    title: "Wallet status",
    description: `The agent wallet on Robinhood Chain: address, USDG balance, ETH balance, whether Permit2 is approved, and the spend cap.${walletNote}`,
    inputSchema: {},
  },
  () => run(walletStatus),
);

server.registerTool(
  "buy_package",
  {
    title: "Buy a package",
    description: `Buy a package with USDG through x402: 10% to the treasury, then 90% to the seller. Returns the package body and filename, and saves it if save_to is given. The wallet approves Permit2 once, which needs a little ETH. Refuses to sign for more than the listed price or the spend cap.${walletNote}`,
    inputSchema: {
      packageId: z.number().int().positive().describe("The onchain packageId, from list_packages"),
      save_to: z.string().optional().describe("Directory to save the package into. The file name comes from the package."),
    },
  },
  ({ packageId, save_to }) =>
    run(async () => {
      const { packages } = await get<{ packages: any[] }>("/packages");
      const pkg = packages.find((p) => p.packageId === packageId);
      if (!pkg) throw new Error(`No live package has packageId ${packageId}.`);
      const price = BigInt(pkg.priceUnits);
      if (price > SPEND_CAP_UNITS) throw new Error(`${pkg.name} costs ${toUsdg(price)} USDG, above the spend cap of ${toUsdg(SPEND_CAP_UNITS)} USDG. Raise SPEND_CAP_USDG to buy it.`);
      const approvalTx = await ensureApproval(price);
      const fee = await pay("/pay/treasury", { packageId }, price);
      const bought = await pay("/pay/seller", { packageId }, price);
      let savedTo: string | undefined;
      if (save_to) {
        savedTo = resolve(save_to, `${pkg.slug}.${bought.filename}`);
        mkdirSync(dirname(savedTo), { recursive: true });
        writeFileSync(savedTo, bought.body);
      }
      return {
        packageId,
        name: pkg.name,
        kind: pkg.kind,
        priceUsdg: pkg.priceUsdg,
        approvalTx,
        feeTx: fee.tx,
        sellerTx: bought.tx,
        filename: bought.filename,
        savedTo,
        body: bought.body,
        note: "A scan lowers risk. It is not a guarantee. Review the package before your agent runs it.",
      };
    }),
);

server.registerTool(
  "ask_model",
  {
    title: "Call a model",
    description: `One paid model call through x402. The price is the upper bound for this request, so keep max_tokens close to what you need. Body is the OpenAI chat format.${walletNote}`,
    inputSchema: {
      model: z.string().min(1).describe("Model key from list_models"),
      messages: z.array(z.object({ role: z.enum(["system", "user", "assistant", "tool"]), content: z.string() })).min(1).max(200),
      max_tokens: z.number().int().min(1).max(8192).optional().describe("Output budget you pay for. Default 500."),
      max_usdg: z.number().positive().optional().describe("The most this call may cost. Default 0.05, never above the spend cap."),
      temperature: z.number().min(0).max(2).optional(),
    },
  },
  ({ model, messages, max_tokens, max_usdg, temperature }) =>
    run(async () => {
      const maxUnits = BigInt(Math.round((max_usdg ?? 0.05) * 1e6));
      await ensureApproval(maxUnits);
      const body: Record<string, unknown> = { messages, max_tokens: max_tokens ?? 500 };
      if (temperature !== undefined) body.temperature = temperature;
      const answer = await pay(`/inference/${encodeURIComponent(model)}`, body, maxUnits);
      return {
        model: answer.model,
        content: answer.choices?.[0]?.message?.content ?? "",
        finish_reason: answer.choices?.[0]?.finish_reason,
        usage: answer.usage,
        paid: answer.paid,
      };
    }),
);

await server.connect(new StdioServerTransport());
