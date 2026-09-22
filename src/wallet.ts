import { createPublicClient, createWalletClient, erc20Abi, http, maxUint256, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { chain, NETWORK, PERMIT2, SPEND_CAP_UNITS, USDG, toUsdg } from "./config.js";
import { post } from "./api.js";

let account: PrivateKeyAccount | undefined;

export function hasWallet() {
  return Boolean(process.env.AGENT_KEY);
}

export function getAccount(): PrivateKeyAccount {
  if (!account) {
    const key = process.env.AGENT_KEY;
    if (!key) throw new Error("AGENT_KEY is not set. Paid tools need a wallet private key on Robinhood Chain that holds USDG.");
    account = privateKeyToAccount(key as Hex);
  }
  return account;
}

export const reader = createPublicClient({ chain, transport: http() });

export async function walletStatus() {
  const a = getAccount();
  const [eth, usdg, allowance] = await Promise.all([
    reader.getBalance({ address: a.address }),
    reader.readContract({ address: USDG, abi: erc20Abi, functionName: "balanceOf", args: [a.address] }),
    reader.readContract({ address: USDG, abi: erc20Abi, functionName: "allowance", args: [a.address, PERMIT2] }),
  ]);
  return {
    address: a.address,
    network: NETWORK,
    ethWei: eth.toString(),
    usdg: toUsdg(usdg),
    usdgUnits: usdg.toString(),
    permit2Approved: allowance > 0n,
    spendCapUsdg: toUsdg(SPEND_CAP_UNITS),
  };
}

/** One time Permit2 approval so signed payments can move USDG. Costs a little ETH once. */
export async function ensureApproval(units: bigint) {
  const a = getAccount();
  const allowance = await reader.readContract({ address: USDG, abi: erc20Abi, functionName: "allowance", args: [a.address, PERMIT2] });
  if (allowance >= units) return null;
  if ((await reader.getBalance({ address: a.address })) === 0n) {
    throw new Error(`${a.address} has no ETH on Robinhood Chain. The one time USDG approval for Permit2 needs a little ETH for gas.`);
  }
  const wallet = createWalletClient({ account: a, chain, transport: http() });
  const hash = await wallet.writeContract({ address: USDG, abi: erc20Abi, functionName: "approve", args: [PERMIT2, maxUint256] });
  await reader.waitForTransactionReceipt({ hash });
  return hash;
}

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");

type Offer = {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: `0x${string}`;
  extra?: { assetTransferMethod?: string; spender?: `0x${string}`; name?: string };
};
type Challenge = { x402Version: number; accepts: Offer[]; resource?: unknown; error?: string };

export function pickOffer(challenge: Challenge) {
  const offer = challenge.accepts?.find((o) => o.network === NETWORK && o.extra?.assetTransferMethod === "permit2");
  if (!offer) throw new Error("The 402 challenge has no USDG offer on Robinhood Chain.");
  if (offer.asset.toLowerCase() !== USDG.toLowerCase()) throw new Error("The challenge asks for a token other than USDG. Refusing to sign.");
  return offer;
}

/** Signs the USDG offer in a 402 challenge and returns the payment-signature header value. */
export async function signPayment(challenge: Challenge, maxUnits: bigint) {
  const a = getAccount();
  const offer = pickOffer(challenge);
  const amount = BigInt(offer.amount);
  const cap = maxUnits < SPEND_CAP_UNITS ? maxUnits : SPEND_CAP_UNITS;
  if (amount > cap) {
    throw new Error(`The challenge asks for ${toUsdg(amount)} USDG, above the allowed ${toUsdg(cap)} USDG. Raise SPEND_CAP_USDG or the tool's max if that is intended.`);
  }
  const nonce = BigInt("0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 240);
  const signature = await a.signTypedData({
    domain: { name: "Permit2", chainId: chain.id, verifyingContract: PERMIT2 },
    types: {
      PermitWitnessTransferFrom: [
        { name: "permitted", type: "TokenPermissions" },
        { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "witness", type: "Witness" },
      ],
      TokenPermissions: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }],
      Witness: [{ name: "to", type: "address" }, { name: "validAfter", type: "uint256" }],
    },
    primaryType: "PermitWitnessTransferFrom",
    message: {
      permitted: { token: offer.asset as `0x${string}`, amount },
      spender: offer.extra!.spender!,
      nonce,
      deadline,
      witness: { to: offer.payTo, validAfter: 0n },
    },
  });
  return b64({
    x402Version: 2,
    accepted: offer,
    resource: challenge.resource,
    payload: {
      signature,
      permit2Authorization: {
        permitted: { token: offer.asset, amount: offer.amount },
        from: a.address,
        spender: offer.extra!.spender,
        nonce: String(nonce),
        deadline: String(deadline),
        witness: { to: offer.payTo, validAfter: "0" },
      },
    },
  });
}

/** POSTs a paid endpoint: the first call returns 402, the second carries the signed payment. */
export async function pay(path: string, body: unknown, maxUnits: bigint) {
  const first = await post(path, body);
  if (first.ok) return first.data;
  if (first.status !== 402) throw new Error(`${path}: ${first.data?.error ?? `HTTP ${first.status}`}`);
  const header = await signPayment(first.data as Challenge, maxUnits);
  const paid = await post(path, body, { "payment-signature": header });
  if (!paid.ok) throw new Error(`${path}: ${paid.data?.error ?? `HTTP ${paid.status}`}`);
  return paid.data;
}

/** Fetches the 402 terms for a paid endpoint without paying. */
export async function quote(path: string, body: unknown) {
  const res = await post(path, body);
  if (res.ok) return { status: res.status, alreadyPaid: true, response: res.data };
  if (res.status !== 402) throw new Error(`${path}: ${res.data?.error ?? `HTTP ${res.status}`}`);
  const offer = pickOffer(res.data as Challenge);
  return {
    status: 402,
    amountUnits: offer.amount,
    amountUsdg: toUsdg(offer.amount),
    asset: offer.asset,
    token: offer.extra?.name ?? "USDG",
    network: offer.network,
    payTo: offer.payTo,
    spender: offer.extra?.spender,
  };
}
