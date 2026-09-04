/**
 * 03-continuous-sync-worker.ts
 *
 * 生产级常驻后台轮询任务示例：
 * EVMEventLake 设计为单次显式调用（one-shot update），不内置隐式轮询定时器。
 * 本示例演示如何编写健壮的后台轮询 Worker，涵盖：
 * 1. 定时触发增量同步 (Periodic update loop)
 * 2. 优雅停机信号处理 (SIGINT / SIGTERM + AbortController)
 * 3. 错误恢复与并发排他租约保护 (SynchronizationLockedError)
 * 4. 基于本地同步游标的“最近 N 个区块”增量消费模式
 *
 * 运行方式:
 *   pnpm run example:worker
 * 或:
 *   node --experimental-strip-types examples/03-continuous-sync-worker.ts
 */

import { setTimeout as sleep } from "node:timers/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EVMEventLake,
  SynchronizationLockedError,
  OperationCancelledError,
} from "@evm-event-lake/node-sdk";

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

// 轮询间隔（毫秒）
const POLL_INTERVAL_MS = 3_000;

// 控制示例运行模式：默认跑 2 轮展示，设置 CONTINUOUS=true 可作为常驻守护进程
const MAX_DEMO_RUNS = process.env.CONTINUOUS === "true" ? Infinity : 2;

async function runWorker(): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), "eventlake-worker-"));
  const dbPath = join(tempDir, "worker_events.db");

  const abortController = new AbortController();
  const { signal } = abortController;

  // 监听进程终止信号，触发优雅退出
  const handleShutdown = (): void => {
    console.log("\n[Worker] 收到退出信号，正在优雅关闭同步进程...");
    abortController.abort();
  };
  process.once("SIGINT", handleShutdown);
  process.once("SIGTERM", handleShutdown);

  console.log("=== 初始化同步 Worker ===");
  const eventLake = await EVMEventLake.create({
    database: `sqlite://${dbPath}`,
    rpcUrls: [BASE_RPC_URL],
    chainId: BASE_CHAIN_ID,
    contractAddress: BASE_USDC_ADDRESS,
    abi: erc20Abi,
    startBlock: SAMPLE_BLOCK,
    synchronization: {
      confirmations: 0, // 示例中使用 0 确认数；生产环境可配置合理确认数（如 12）
      defaultBlockRange: 10,
    },
  });

  let runCount = 0;

  try {
    console.log(
      `[Worker] 启动轮询循环 (间隔: ${POLL_INTERVAL_MS}ms, 最大演示次数: ${MAX_DEMO_RUNS === Infinity ? "无限" : MAX_DEMO_RUNS})`,
    );

    while (!signal.aborted && runCount < MAX_DEMO_RUNS) {
      runCount++;
      console.log(
        `\n--- 第 ${runCount} 次同步开始 [${new Date().toISOString()}] ---`,
      );

      try {
        // 读取当前本地数据库游标
        const statusBefore = await eventLake.getSyncStatus();
        console.log(
          `[Worker] 本地游标: nextBlock=${statusBefore.nextBlock}, 已确认同步到=${statusBefore.syncedThroughBlock ?? "无"}`,
        );

        // 调用 update 执行单次增量同步（传递 signal 支持随时中断）
        // 在示例中同步指定测试区块，实际常驻服务中不传 toBlock 即自动同步到最新确认区块
        const result = await eventLake.update({
          toBlock: SAMPLE_BLOCK,
          signal,
        });

        console.log(`[Worker] 同步结果: outcome=${result.outcome}`);
        console.log(
          `[Worker] 统计: 新增日志=${result.storedLogs}, 解码=${result.decodedLogs}, 耗时=${result.durationMs}ms`,
        );

        // 业务处理：如果同步到了新数据，可在此消费处理最新区块内的业务逻辑
        if (result.outcome === "synchronized") {
          const latestEvents = await eventLake.events.findMany({
            where: {
              blockNumber: {
                greaterThanOrEqual: result.fromBlock,
                lessThanOrEqual: result.toBlock,
              },
            },
            limit: 3,
            order: "descending",
          });
          console.log(
            `[Worker] 消费最新已同步事件 (前 ${latestEvents.items.length} 条):`,
          );
          for (const ev of latestEvents.items) {
            console.log(
              `  - Block ${ev.blockNumber} Tx ${ev.transactionHash.slice(0, 12)}...`,
            );
          }
        }
      } catch (error) {
        if (error instanceof OperationCancelledError) {
          console.log("[Worker] 同步已被主动取消。");
          break;
        } else if (error instanceof SynchronizationLockedError) {
          console.warn(
            "[Worker] 检测到租约锁定，可能另一个 Worker 正在同步，稍后重试。",
          );
        } else {
          console.error("[Worker] 同步遇到异常:", error);
        }
      }

      // 等待下一次轮询，等待期间若收到 abort 信号立即唤醒退出
      if (!signal.aborted && runCount < MAX_DEMO_RUNS) {
        console.log(`[Worker] 等待 ${POLL_INTERVAL_MS}ms 后执行下一次轮询...`);
        try {
          await sleep(POLL_INTERVAL_MS, undefined, { signal });
        } catch {
          // sleep 被 signal 中断，退出循环
          break;
        }
      }
    }
  } finally {
    // 确保无论正常退出还是异常退出，都正确关闭客户端释放数据库锁
    process.removeListener("SIGINT", handleShutdown);
    process.removeListener("SIGTERM", handleShutdown);
    await eventLake.close();
    await rm(tempDir, { force: true, recursive: true });
    console.log("\n[Worker] 客户端与资源已彻底释放，安全退出。");
  }
}

await runWorker();
