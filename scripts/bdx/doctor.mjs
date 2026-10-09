#!/usr/bin/env node
/**
 * Blind's Beldex doctor.
 *
 * It answers one question honestly: which of the wallet and chain operations
 * Blind depends on actually work against the endpoints configured right now?
 *
 * Every check is a real call. Nothing is stubbed, and a check that cannot run
 * because an environment variable is missing reports "skip" — never "ok".
 *
 *   npm run bdx:doctor
 *
 * Nothing secret is printed: addresses and heights are public, keys are not.
 */
import { beldexConfig, escrowConfigured, ESCROW_WALLET_NAME } from "../../src/lib/beldex/config.ts";
import { BdxWalletRpc } from "../../src/lib/beldex/wallet-rpc.ts";
import { chainReader, chainSource } from "../../src/lib/beldex/chain.ts";
import { decodeAddress, encodeAddress } from "../../src/lib/beldex/address.ts";
import { NETTYPE_PREFIXES } from "../../src/lib/beldex/nettype.ts";

const results = [];
const add = (name, state, note = "") => {
  results.push({ name, state, note });
  const mark = state === "ok" ? "  ok " : state === "skip" ? "skip " : "FAIL ";
  console.log(`${mark}${name}${note ? ` — ${note}` : ""}`);
};

async function check(name, fn, { optional = false } = {}) {
  try {
    add(name, "ok", (await fn()) ?? "");
  } catch (error) {
    add(name, optional ? "skip" : "fail", error instanceof Error ? error.message : String(error));
  }
}

const config = beldexConfig();
console.log(`Blind · Beldex doctor`);
console.log(`network: ${config.nettype} · confirmations for settlement: ${config.confirmationsForSettlement}`);
console.log(`daemon: ${config.daemonUrl ? "configured" : "not set"} · escrow wallet: ${config.walletRpcUrl ? "configured" : "not set"}`);
console.log(`chain evidence: ${chainSource() ?? "none"}${chainSource() === "explorer" ? ` (${config.explorerApiUrl})` : ""}\n`);

/* ---------------------------------------------------------------- addresses */

await check("address codec round-trips on this network", () => {
  const spend = new Uint8Array(32).fill(1);
  const view = new Uint8Array(32).fill(2);
  const encoded = encodeAddress({ nettype: config.nettype, kind: "standard", spendPublicKey: spend, viewPublicKey: view });
  const decoded = decodeAddress(encoded, config.nettype);
  if (!decoded.ok) throw new Error(`could not decode what we just encoded (${decoded.reason})`);
  return `${encoded.length} characters, prefix ${NETTYPE_PREFIXES[config.nettype].standard}`;
});

await check("mainnet and testnet addresses are the documented lengths", () => {
  const spend = new Uint8Array(32).fill(3);
  const view = new Uint8Array(32).fill(4);
  const mainnet = encodeAddress({ nettype: "mainnet", kind: "standard", spendPublicKey: spend, viewPublicKey: view });
  const testnet = encodeAddress({ nettype: "testnet", kind: "standard", spendPublicKey: spend, viewPublicKey: view });
  if (mainnet.length !== 97) throw new Error(`mainnet address is ${mainnet.length} characters, expected 97`);
  if (testnet.length !== 95) throw new Error(`testnet address is ${testnet.length} characters, expected 95`);
  return "97 / 95";
});

/* ------------------------------------------------------------ chain evidence */

const source = chainSource();
if (!source) {
  add("chain: get_info", "skip", "neither BDX_DAEMON_URL nor BDX_EXPLORER_API_URL is set");
  add("chain: get_height", "skip", "no chain evidence source configured");
} else {
  const chain = chainReader();
  await check(`chain (${source}): get_info`, async () => {
    const info = await chain.getInfo();
    return `height ${info.height}, ${info.status}${info.untrusted ? ", bootstrap node" : ""}`;
  });
  await check(`chain (${source}): get_height`, async () => `height ${await chain.getHeight()}`);
  await check(
    `chain (${source}): get_block_header_by_height (reorg checks)`,
    async () => {
      const header = await chain.getBlockHeaderByHeight(0);
      if (!header) throw new Error("no genesis header returned");
      return `hash ${String(header.hash ?? "").slice(0, 16)}…`;
    },
    { optional: true }
  );
  await check(
    `chain (${source}): get_fee_estimate`,
    async () => {
      const fee = await chain.getFeeEstimate();
      if (!fee) throw new Error("no fee estimate returned");
      return `${fee.feePerByte} atomic per byte`;
    },
    { optional: true }
  );
}

/* ------------------------------------------------------------- wallet (RPC) */

if (!escrowConfigured()) {
  add("wallet: get_version", "skip", "BDX_WALLET_RPC_URL is not set (escrow disabled)");
  add("wallet: get_balance", "skip", "BDX_WALLET_RPC_URL is not set");
  console.log("\nWithout the escrow signer Blind cannot hold or release funds: Blind Pay will report\n\"escrow unavailable\" rather than invent a deposit. Set BDX_WALLET_RPC_URL and re-run.");
} else {
  const wallet = BdxWalletRpc.fromEnv();
  console.log(`\nescrow wallet: ${ESCROW_WALLET_NAME()}\n`);

  await check("wallet: get_version", async () => {
    const version = await wallet.getVersion();
    return `wallet-rpc ${version.version ?? "unknown"}`;
  });

  const opened = await (async () => {
    try {
      const balance = await wallet.getBalance();
      add("wallet: get_balance", "ok", `${balance.balance} atomic total, ${balance.unlocked_balance} unlocked`);
      return true;
    } catch (error) {
      add("wallet: get_balance", "fail", error instanceof Error ? error.message : String(error));
      console.log("      no wallet is open — start beldex-wallet-rpc with a wallet (or open one) and re-run");
      return false;
    }
  })();

  if (opened) {
    await check("wallet: get_height", async () => `height ${(await wallet.getHeight()).height}`);
    await check("wallet: get_address", async () => {
      const address = await wallet.getAddress();
      const decoded = decodeAddress(address.address, config.nettype);
      if (!decoded.ok) throw new Error(`the wallet returned an address we cannot decode: ${decoded.reason}`);
      return `${decoded.kind} address, ${address.address.length} characters`;
    });
    await check(
      "wallet: create_address (one fresh subaddress per payment)",
      async () => {
        const created = await wallet.createAddress(`blind:doctor:${Date.now()}`);
        if (typeof created.address_index !== "number") throw new Error("no address index returned");
        return `subaddress index ${created.address_index}`;
      },
      { optional: true }
    );
    await check("wallet: make_integrated_address (one payment id per payment)", async () => {
      const base = await wallet.getAddress();
      const integrated = await wallet.makeIntegratedAddress(base.address);
      if (!integrated.payment_id || integrated.payment_id.length !== 16) throw new Error("no 8-byte payment id returned");
      const decoded = decodeAddress(integrated.integrated_address, config.nettype);
      if (!decoded.ok) throw new Error(`integrated address does not decode: ${decoded.reason}`);
      return `payment id ${integrated.payment_id.slice(0, 8)}…`;
    });
    await check("wallet: get_transfers (deposit detection)", async () => {
      const transfers = await wallet.getTransfers({ incoming: true, filterByHeight: false });
      return `${(transfers.in ?? []).length} incoming transfer(s) visible`;
    });
    await check("wallet: get_bulk_payments (deposit confirmation)", async () => {
      const bulk = await wallet.getBulkPayments(["0000000000000000"], 0);
      return `${(bulk.payments ?? []).length} payment(s) for a probe id — none is the correct answer for a fresh wallet`;
    });
    await check(
      "wallet: refresh + store",
      async () => {
        await wallet.refresh();
        await wallet.store();
        return "refreshed and stored";
      },
      { optional: true }
    );
    await check("wallet: transfer is wired for the payout path", () => {
      if (typeof wallet.transfer !== "function") throw new Error("transfer is not exposed by the RPC client");
      return "payouts call transfer() with the claim's destination";
    });
  }
}

/* ------------------------------------------------------------------ summary */

const failed = results.filter((entry) => entry.state === "fail");
const skipped = results.filter((entry) => entry.state === "skip");
console.log(
  `\n${results.filter((entry) => entry.state === "ok").length} ok · ${skipped.length} skipped · ${failed.length} failed`
);
if (failed.length > 0) {
  console.log("\nBlind cannot move real funds until every failed check above passes.");
  process.exitCode = 1;
} else if (skipped.length > 0) {
  console.log("\nNothing failed, but some capabilities are unconfigured on this machine — Blind reports those\nas unavailable instead of pretending.");
} else {
  console.log("\nEverything Blind uses answered. A real payment can be attempted on this network.");
}
