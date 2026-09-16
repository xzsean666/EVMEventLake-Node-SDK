/**
 * 09-native-topic-filters.ts
 *
 * 原生 getLogs Topic Filters 过滤示例:
 * 展示如何在 RPC 层通过 `topic0`..`topic3` 或 `topics` 数组进行精准过滤，
 * 避免全量拉取合约的所有事件，极大节约网络带宽并突破单次 RPC 日志上限。
 *
 * 支持特性:
 * - 20 字节 EVM 地址自动补齐为 32 字节 (`padHex(addr, { size: 32, dir: "left" })`)
 * - 原生 `bigint` 与 `number`（如 tokenId、金额）自动编码为 32 字节十六进制
 * - 原生 `boolean` 布尔过滤
 * - 32 字节 Hex（`bytes32`、角色 Hash、事件签名）
 * - 省略 `topic0` 进行跨事件通配过滤（Wildcard）
 * - 嵌套数组表达逻辑 OR 过滤
 *
 * 运行方式:
 *   pnpm run example:topics
 * 或:
 *   node --experimental-strip-types examples/09-native-topic-filters.ts
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EVMEventLake } from "@evm-event-lake/node-sdk";

// 1. 定义 ABI
const usdcAbi = [
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

// Base 主网 USDC 配置
const BASE_CHAIN_ID = 8_453;
const BASE_USDC_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const BASE_RPC_URL = "https://mainnet.base.org";
const SAMPLE_BLOCK = 48_625_053n;

// Transfer(address,address,uint256) 的 topic0 签名
const TRANSFER_TOPIC0 =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// 该区块中真实存在的一个频繁收款地址
const TARGET_RECIPIENT = "0xCf40563a1159bf8B8126255E5866E1A29469423C";

async function main(): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), "eventlake-topics-"));
  const dbPath = join(tempDir, "usdc_filtered.db");

  try {
    console.log("=== 场景 1: 在实例级别配置默认 Topic 过滤 ===");
    console.log(
      "配置目标: 只同步转账至指定收款人 (topic2 = TARGET_RECIPIENT) 的 Transfer 事件",
    );

    const eventLake = await EVMEventLake.create({
      database: `sqlite://${dbPath}`,
      rpcUrls: [BASE_RPC_URL],
      chainId: BASE_CHAIN_ID,
      contractAddress: BASE_USDC_ADDRESS,
      abi: usdcAbi,
      startBlock: SAMPLE_BLOCK,
      // 方式 A: 直接使用命名属性 topic0..topic3
      // 注意: 20 字节地址会自动高位补 0 转换为 32 字节 EVM topic
      topic0: TRANSFER_TOPIC0,
      topic2: TARGET_RECIPIENT,
    });

    console.log("\n=== 执行 update()，RPC 仅返回命中 topic2 的日志 ===");
    const result1 = await eventLake.update({ toBlock: SAMPLE_BLOCK });
    console.log(`同步完成:`);
    console.log(
      `- 存储日志数: ${result1.storedLogs} (全量未过滤前该区块有 76 条日志)`,
    );

    const records1 = await eventLake.events.findMany({
      where: { eventName: "Transfer" },
    });
    for (const log of records1.items) {
      const args = log.arguments as { from: string; to: string; value: bigint };
      console.log(
        `  -> 命中收款人: ${args.to} | 发送人: ${args.from} | 金额: ${Number(args.value) / 1e6} USDC`,
      );
    }

    console.log("\n=== 场景 2: 在 update() 时动态指定/覆写 Topic 过滤 ===");
    console.log(
      "演示特性: 忽略 topic0 (通配任意事件), 支持逻辑 OR 数组与原生类型",
    );

    // 假设在另一个区块中执行动态过滤
    const result2 = await eventLake.update({
      toBlock: SAMPLE_BLOCK,
      // 方式 B: 标准 JSON-RPC 数组写法
      topics: [
        // topic0 为 null 或省略时表示通配符: 匹配该合约发生的任意事件
        null,
        // topic1 传入数组: 逻辑 OR 过滤 (匹配任一地址)
        [
          "0xb4CB80e81c7e999908da684fef947F159C24cf40",
          "0xd0b53D57e84F17fa008dffF87eAfa4Dff3d85d03",
        ],
      ],
    });
    console.log(`动态过滤更新执行完成，结果: ${result2.outcome}`);

    console.log("\n=== 场景 3: 支持的数据类型说明 ===");
    console.log("EVMEventLake 原生支持以下类型的 Topic 输入:");
    console.log("1. 20 字节 EVM 地址: 如 '0x111...11' (自动左补齐为 32 字节)");
    console.log("2. 32 字节十六进制: 如 bytes32 角色 Hash、事件签名 topic0");
    console.log(
      "3. 原生 bigint: 如 12345n (自动编码为 32 字节 hex，适合 ERC-721 tokenId)",
    );
    console.log("4. 原生 number: 如 42 (安全整数自动转为 32 字节 hex)");
    console.log(
      "5. 原生 boolean: 如 true (编码为 0x...01) / false (编码为 0x...00)",
    );
    console.log("6. 数组形式: 如 [ALICE, BOB] (表达逻辑 OR)");

    await eventLake.close();
    console.log("\n客户端已安全关闭。");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error("运行失败:", error);
  process.exit(1);
});
