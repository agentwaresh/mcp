export const API = (process.env.AGENTWARE_API ?? "https://agentware.sh/api").replace(/\/$/, "");
export const CHAIN_ID = 4663;
export const NETWORK = `eip155:${CHAIN_ID}`;
export const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const;
export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

/** The most USDG a single payment may sign for. Defaults to 5 USDG. */
export const SPEND_CAP_UNITS = BigInt(Math.round(Number(process.env.SPEND_CAP_USDG ?? 5) * 1e6));

export const KINDS = ["skill", "prompt", "mcp", "workflow", "code"] as const;
export const CATEGORIES = ["payments", "onchain", "research", "coding", "devops", "data", "content", "security", "other"] as const;

export const chain = {
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [`${API}/rpc`] } },
} as const;

export const toUsdg = (units: bigint | string) => Number(BigInt(units)) / 1e6;
