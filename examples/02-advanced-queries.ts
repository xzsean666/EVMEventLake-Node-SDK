/**
 * 02-advanced-queries.ts
 *
 * 高级查询与游标分页示例：
 * 演示按 indexed 参数过滤、按区块范围过滤、按交易哈希过滤、游标翻页（Cursor Pagination）
 * 以及读取原始日志与已解码日志。
 *
 * 运行方式:
 *   pnpm run example:query
 * 或:
 *   node --experimental-strip-types examples/02-advanced-queries.ts
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EventRecord } from "@evm-event-lake/node-sdk";
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
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "owner", type: "address" },
      { indexed: true, name: "spender", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
    name: "Approval",
    type: "event",
  },
] as const;

const BASE_CHAIN_ID = 8_453;
const BASE_USDC_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const BASE_RPC_URL = "https://mainnet.base.org";
const SAMPLE_BLOCK = 48_625_053n;

async function main(): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), "eventlake-query-"));
  const dbPath = join(tempDir, "events.db");

  const eventLake = await EVMEventLake.create({
    database: `sqlite://${dbPath}`,
    rpcUrls: [BASE_RPC_URL],
    chainId: BASE_CHAIN_ID,
    contractAddress: BASE_USDC_ADDRESS,
    abi: erc20Abi,
    startBlock: SAMPLE_BLOCK,
  });

  try {
    console.log(`=== 1. 同步示例区块 ${SAMPLE_BLOCK} ===`);
    await eventLake.update({ toBlock: SAMPLE_BLOCK });
    console.log("同步完成，所有后续查询均为本地数据库查询，无需 RPC。\n");

    // -------------------------------------------------------------
    // 场景 A: findFirst - 获取匹配条件的第一条记录
    // -------------------------------------------------------------
    console.log("=== 场景 A: findFirst 查询最新的第一条 Transfer 事件 ===");
    const firstEvent: EventRecord | null = await eventLake.events.findFirst({
      where: {
        eventName: "Transfer",
      },
      order: "descending", // 降序排列，获取最新的事件
    });

    if (firstEvent !== null) {
      console.log(`找到最新 Transfer 事件:`);
      console.log(
        `- 区块: ${firstEvent.blockNumber}, 日志索引: ${firstEvent.logIndex}`,
      );
      console.log(`- 交易哈希: ${firstEvent.transactionHash}`);
      console.log(`- 解码参数:`, firstEvent.arguments);
    }

    // -------------------------------------------------------------
    // 场景 B: 按 indexed 参数过滤 (例如查询收款方为某地址的所有转账)
    // -------------------------------------------------------------
    console.log("\n=== 场景 B: 按 indexed 参数 (to 地址) 精准过滤 ===");
    const targetRecipient = "0xCf40563a1159bf8B8126255E5866E1A29469423C";
    const toTransfers = await eventLake.events.findMany({
      where: {
        eventSignature: "Transfer(address,address,uint256)",
        indexedParameters: {
          to: targetRecipient,
        },
      },
      order: "ascending",
    });
    console.log(
      `收款地址 ${targetRecipient} 共有 ${toTransfers.items.length} 笔入账:`,
    );
    for (const item of toTransfers.items) {
      const args = item.arguments as { from: string; value: bigint };
      console.log(
        `  转账自: ${args.from} -> 金额: ${(Number(args.value) / 1e6).toFixed(2)} USDC`,
      );
    }

    // -------------------------------------------------------------
    // 场景 C: 按区块范围过滤 (Block Range Filter)
    // -------------------------------------------------------------
    console.log("\n=== 场景 C: 按区块范围过滤 ===");
    const rangeEvents = await eventLake.events.findMany({
      where: {
        blockNumber: {
          greaterThanOrEqual: SAMPLE_BLOCK,
          lessThanOrEqual: SAMPLE_BLOCK,
        },
      },
      limit: 10,
    });
    console.log(`在指定区块范围内找到 ${rangeEvents.items.length} 条事件`);

    // -------------------------------------------------------------
    // 场景 D: 游标分页 (Cursor Pagination)
    // -------------------------------------------------------------
    console.log("\n=== 场景 D: 游标分页 (遍历全部事件) ===");
    let pageCount = 0;
    let totalEvents = 0;
    let cursor: string | null | undefined = undefined;
    const pageSize = 20;

    while (true) {
      const page = await eventLake.events.findMany({
        where: { eventName: "Transfer" },
        limit: pageSize,
        order: "ascending",
        ...(cursor !== undefined ? { after: cursor ?? undefined } : {}),
      });

      pageCount++;
      totalEvents += page.items.length;
      console.log(
        `  第 ${pageCount} 页: 获得 ${page.items.length} 条记录 (nextCursor: ${page.nextCursor ? page.nextCursor.slice(0, 15) + "..." : "null"})`,
      );

      if (page.nextCursor === null || page.items.length === 0) {
        break; // 没有更多数据，结束翻页
      }
      cursor = page.nextCursor;
    }
    console.log(
      `游标翻页完成: 共 ${pageCount} 页，累计 ${totalEvents} 条 Transfer 事件。`,
    );

    // -------------------------------------------------------------
    // 场景 E: 查看解码状态与原始日志 (Decoded vs Raw Logs)
    // -------------------------------------------------------------
    console.log("\n=== 场景 E: 日志解码状态与原始数据字段 ===");
    const sampleRecord = rangeEvents.items[0];
    if (sampleRecord) {
      console.log(`- 解码状态 (decodeStatus): ${sampleRecord.decodeStatus}`);
      console.log(
        `- 事件签名 (eventSignature): ${sampleRecord.eventSignature}`,
      );
      console.log(`- 原始 Topics (topics 长度): ${sampleRecord.topics.length}`);
      console.log(`- 原始 Data (data): ${sampleRecord.data.slice(0, 20)}...`);
      console.log(`- 解码后参数 (arguments):`, sampleRecord.arguments);
    }
  } finally {
    await eventLake.close();
    await rm(tempDir, { force: true, recursive: true });
    console.log("\n客户端已安全关闭。");
  }
}

await main();
