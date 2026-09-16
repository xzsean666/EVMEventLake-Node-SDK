/**
 * 08-event-enrichment-hook.ts
 *
 * 业务数据富化挂钩示例 (Custom Event Enrichment Hook):
 * 展示如何通过 `enrichEvent` 回调函数在事件落库时进行领域数据增强计算，
 * 并持久化存储至 `additional_data` 列中，供后续查询与业务分析。
 *
 * 运行方式:
 *   pnpm run example:enrichment
 * 或:
 *   node --experimental-strip-types examples/08-event-enrichment-hook.ts
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EVMEventLake,
  type EventEnrichmentContext,
} from "@evm-event-lake/node-sdk";

// 1. ERC-20 Transfer 事件 ABI
const erc20Abi = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
    name: "Transfer",
    type: "event",
  },
] as const;

// Base 主网 USDC 合约与公共 RPC 配置
const BASE_CHAIN_ID = 8_453;
const BASE_USDC_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const BASE_RPC_URL = "https://mainnet.base.org";
const SAMPLE_BLOCK = 48_625_053n;

// 定义业务富化数据的 TypeScript 类型
interface UsdcTransferEnrichment {
  tier: "whale" | "large" | "standard";
  formattedUsdc: string;
  syncedAtIso: string;
  txShort: string;
  sourceModule: string;
}

/**
 * 自定义事件富化挂钩函数
 *
 * 接收 EventEnrichmentContext 上下文:
 * - blockNumber, transactionHash, logIndex, transactionIndex
 * - eventName, eventSignature, eventId
 * - raw topics & data
 * - decodedArguments (已解码参数)
 */
function customTransferEnricher(
  context: EventEnrichmentContext,
): UsdcTransferEnrichment | null {
  // 仅针对 Transfer 事件进行业务富化
  if (context.eventName !== "Transfer" || !context.arguments) {
    return null;
  }

  const rawValue = (context.arguments as { value?: bigint }).value ?? 0n;
  const usdcUnits = Number(rawValue) / 1_000_000;

  let tier: UsdcTransferEnrichment["tier"] = "standard";
  if (usdcUnits >= 1000) {
    tier = "whale";
  } else if (usdcUnits >= 100) {
    tier = "large";
  }

  return {
    tier,
    formattedUsdc: `${usdcUnits.toFixed(2)} USDC`,
    syncedAtIso: new Date().toISOString(),
    txShort: `${context.transactionHash.slice(0, 10)}...`,
    sourceModule: "billing-classifier-v1",
  };
}

async function main(): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), "eventlake-enrichment-"));
  const dbPath = join(tempDir, "usdc_enriched.db");

  try {
    console.log("=== 1. 初始化集成 enrichEvent 的 EVMEventLake 实例 ===");

    const eventLake = await EVMEventLake.create({
      database: `sqlite://${dbPath}`,
      rpcUrls: [BASE_RPC_URL],
      chainId: BASE_CHAIN_ID,
      contractAddress: BASE_USDC_ADDRESS,
      abi: erc20Abi,
      startBlock: SAMPLE_BLOCK,
      // 挂载实例级默认富化钩子
      enrichEvent: customTransferEnricher,
    });

    console.log("=== 2. 执行单次同步，富化钩子在事务内随日志落库触发 ===");
    const result = await eventLake.update({ toBlock: SAMPLE_BLOCK });

    console.log(`同步结果:`);
    console.log(`- 存储日志条数: ${result.storedLogs}`);
    console.log(`- 解码日志条数: ${result.decodedLogs}`);

    console.log("\n=== 3. 查询带 additionalData 业务元数据的事件记录 ===");
    const page = await eventLake.events.findMany({
      where: { eventName: "Transfer" },
      limit: 6,
      order: "descending",
    });

    for (const record of page.items) {
      // additionalData 存储了 enrichEvent 返回的持久化数据
      const enrichment = record.additionalData as UsdcTransferEnrichment | null;
      const args = record.arguments as {
        from: string;
        to: string;
        value: bigint;
      };

      console.log(
        `[${enrichment?.tier?.toUpperCase() || "N/A"}] Tx: ${enrichment?.txShort || record.transactionHash.slice(0, 10)} ` +
          `| From: ${args.from.slice(0, 8)}... ` +
          `| To: ${args.to.slice(0, 8)}... ` +
          `| 金额: ${enrichment?.formattedUsdc || args.value.toString()} ` +
          `| 来源模块: ${enrichment?.sourceModule}`,
      );
    }

    console.log("\n=== 4. 演示在单次 update() 中动态覆写 enrichEvent ===");
    // 在 update() 时可以临时指定不同的富化规则（例如做历史回溯或批处理打标）
    const customUpdateResult = await eventLake.update({
      toBlock: SAMPLE_BLOCK,
      enrichEvent: (ctx) => ({
        batchTag: "hotfix-sync-pass",
        processedAt: Date.now(),
        eventId: ctx.eventId,
      }),
    });
    console.log(`动态覆写更新执行完成，结果: ${customUpdateResult.outcome}`);

    await eventLake.close();
    console.log("\n已成功关闭 SDK 客户端。");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error("运行失败:", error);
  process.exit(1);
});
