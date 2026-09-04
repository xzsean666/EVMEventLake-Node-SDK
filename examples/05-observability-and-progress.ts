/**
 * 05-observability-and-progress.ts
 *
 * 监控与进度追踪示例：
 * 演示如何接入结构化日志记录器（SdkLogger）和实时阶段进度回调（onProgress），
 * 捕获节点校验、分块请求、自适应拆分、批次落库以及区块重组等生命周期事件。
 *
 * 运行方式:
 *   pnpm run example:observability
 * 或:
 *   node --experimental-strip-types examples/05-observability-and-progress.ts
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  SdkLogEvent,
  SdkLogger,
  UpdateProgressCallback,
  UpdateProgressEvent,
} from "@evm-event-lake/node-sdk";
import { EVMEventLake } from "@evm-event-lake/node-sdk";

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

const BASE_CHAIN_ID = 8_453;
const BASE_USDC_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const BASE_RPC_URL = "https://mainnet.base.org";
const SAMPLE_BLOCK = 48_625_053n;

// 1. 实现自定义结构化 Logger
const customLogger: SdkLogger = {
  log(event: SdkLogEvent): void {
    const levelIcons = {
      debug: "🔍 [DEBUG]",
      info: "ℹ️  [INFO ]",
      warn: "⚠️  [WARN ]",
      error: "❌ [ERROR]",
    };
    const icon = levelIcons[event.level] ?? "[LOG]";
    console.log(
      `${icon} (${event.event}): ${event.message}`,
      event.context ? JSON.stringify(event.context) : "",
    );
  },
};

// 2. 实现实时阶段进度监听器
const progressListener: UpdateProgressCallback = (
  event: UpdateProgressEvent,
): void => {
  const stageDescriptions: Record<string, string> = {
    update_started: "🚀 同步任务启动",
    endpoint_validated: "✅ RPC 节点 Chain ID 校验通过",
    range_fetch_started: "📡 开始抓取区块范围日志",
    range_split: "✂️  区块范围过大或超时，执行自适应二分拆分",
    range_committed: "💾 区块范围日志与游标原子性落库完成",
    reorg_rewind: "🔄 检测到链分叉回退（Reorg），正在回滚并重新对齐",
    update_completed: "🏁 同步任务执行完毕",
  };

  const desc = stageDescriptions[event.stage] ?? event.stage;
  console.log(
    `  --> [进度阶段] ${desc}`,
    event.context ? JSON.stringify(event.context) : "",
  );
};

async function main(): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), "eventlake-observability-"));
  const dbPath = join(tempDir, "events.db");

  console.log("=== 初始化带可观测性的 EVMEventLake 实例 ===\n");
  const eventLake = await EVMEventLake.create({
    database: `sqlite://${dbPath}`,
    rpcUrls: [BASE_RPC_URL],
    chainId: BASE_CHAIN_ID,
    contractAddress: BASE_USDC_ADDRESS,
    abi: erc20Abi,
    startBlock: SAMPLE_BLOCK,
    observability: {
      logger: customLogger,
      onProgress: progressListener,
    },
  });

  try {
    console.log("\n=== 执行单次同步，观察日志与进度阶段触发 ===");
    const updateResult = await eventLake.update({
      toBlock: SAMPLE_BLOCK,
    });

    console.log("\n=== 同步执行报告汇总 (UpdateResult) ===");
    console.log(`- 最终结果: ${updateResult.outcome}`);
    console.log(
      `- 区块范围: ${updateResult.fromBlock} ~ ${updateResult.toBlock}`,
    );
    console.log(`- 新游标: nextBlock=${updateResult.resultingNextBlock}`);
    console.log(`- RPC 请求数: ${updateResult.rpcRequests}`);
    console.log(
      `- 节点故障转移 (Failover): ${updateResult.endpointFailovers} 次`,
    );
    console.log(`- 范围拆分 (Range Splits): ${updateResult.rangeSplits} 次`);
    console.log(`- 提交区块区间数: ${updateResult.committedRanges}`);
    console.log(`- 抓取日志数: ${updateResult.fetchedLogs}`);
    console.log(`- 成功存储: ${updateResult.storedLogs}`);
    console.log(`- 解码成功: ${updateResult.decodedLogs}`);
    console.log(`- 未知事件: ${updateResult.unknownLogs}`);
    console.log(
      `- 重组回退 (Rewind): ${updateResult.rewind ? JSON.stringify(updateResult.rewind) : "无"}`,
    );
    console.log(`- 总耗时: ${updateResult.durationMs}ms`);
  } finally {
    await eventLake.close();
    await rm(tempDir, { force: true, recursive: true });
    console.log("\n客户端已安全关闭。");
  }
}

await main();
