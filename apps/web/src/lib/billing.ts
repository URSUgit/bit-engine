/**
 * On-chain billing: verify a USDC transfer to the treasury and upgrade the
 * user's plan. Card rails (Stripe) come later as a parallel path.
 *
 * Server-side only — never import from client components.
 */
import {
  createPublicClient,
  http,
  parseEventLogs,
  erc20Abi,
  type Address,
  type Hash,
} from "viem";
import { base, baseSepolia, mainnet, sepolia } from "viem/chains";

const CHAINS = {
  [base.id]: base,
  [baseSepolia.id]: baseSepolia,
  [mainnet.id]: mainnet,
  [sepolia.id]: sepolia,
} as const;

// Canonical USDC deployments per supported chain.
const USDC: Record<number, Address> = {
  [base.id]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  [baseSepolia.id]: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  [mainnet.id]: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  [sepolia.id]: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
};

export interface BillingConfig {
  chainId: number;
  chainName: string;
  receiver: Address | null;
  usdc: Address;
  /** Price in whole USDC for the pro plan. */
  proPriceUsdc: number;
  /** Raw 6-decimals units. */
  proPriceUnits: bigint;
  configured: boolean;
}

export function billingConfig(): BillingConfig {
  const chainId = Number(process.env.PAYMENT_CHAIN_ID ?? base.id);
  const chain = CHAINS[chainId as keyof typeof CHAINS];
  if (!chain) throw new Error(`Unsupported PAYMENT_CHAIN_ID ${chainId}`);
  const receiver = (process.env.PAYMENT_RECEIVER_ADDRESS ?? "") as Address;
  const proPriceUsdc = Number(process.env.PRO_PRICE_USDC ?? 20);
  return {
    chainId,
    chainName: chain.name,
    receiver: /^0x[0-9a-fA-F]{40}$/.test(receiver) ? receiver : null,
    usdc: (process.env.PAYMENT_USDC_ADDRESS as Address) ?? USDC[chainId],
    proPriceUsdc,
    proPriceUnits: BigInt(Math.round(proPriceUsdc * 1e6)),
    configured: /^0x[0-9a-fA-F]{40}$/.test(receiver),
  };
}

function client(chainId: number) {
  const chain = CHAINS[chainId as keyof typeof CHAINS];
  return createPublicClient({
    chain,
    transport: http(process.env.PAYMENT_RPC_URL || undefined),
  });
}

export type VerifyResult =
  | { ok: true; amountUnits: bigint; from: Address }
  | { ok: false; reason: string };

/** Minimum confirmations before a payment is accepted. */
const MIN_CONFIRMATIONS = BigInt(2);

/**
 * Verify that `txHash` is a confirmed USDC transfer of at least the pro
 * price from `payer` to the configured receiver.
 */
export async function verifyUsdcPayment(txHash: Hash, payer: Address): Promise<VerifyResult> {
  const cfg = billingConfig();
  if (!cfg.receiver) return { ok: false, reason: "Billing not configured: set PAYMENT_RECEIVER_ADDRESS" };
  const pc = client(cfg.chainId);

  let receipt;
  try {
    receipt = await pc.getTransactionReceipt({ hash: txHash });
  } catch {
    return { ok: false, reason: "Transaction not found — is it on the right network and mined?" };
  }
  if (receipt.status !== "success") return { ok: false, reason: "Transaction reverted" };

  const latest = await pc.getBlockNumber();
  if (latest - receipt.blockNumber < MIN_CONFIRMATIONS) {
    return { ok: false, reason: "Waiting for confirmations — retry in a few seconds" };
  }

  // Find a USDC Transfer(payer -> receiver) in this tx's logs. parseEventLogs
  // tolerates unrelated logs; we filter to the USDC contract explicitly.
  const transfers = parseEventLogs({
    abi: erc20Abi,
    eventName: "Transfer",
    logs: receipt.logs.filter((l) => l.address.toLowerCase() === cfg.usdc.toLowerCase()),
  });
  const match = transfers.find(
    (t) =>
      t.args.from.toLowerCase() === payer.toLowerCase() &&
      t.args.to.toLowerCase() === cfg.receiver!.toLowerCase()
  );
  if (!match) return { ok: false, reason: "No USDC transfer from your wallet to the treasury in this transaction" };
  if (match.args.value < cfg.proPriceUnits) {
    return {
      ok: false,
      reason: `Amount too low: ${Number(match.args.value) / 1e6} USDC sent, ${cfg.proPriceUsdc} required`,
    };
  }
  return { ok: true, amountUnits: match.args.value, from: payer };
}
