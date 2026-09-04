/**
 * 01-erc20-basic.ts
 *
 * 极简入门示例：同步并查询 ERC-20 代币（以 Base 主网 USDC 为例）事件。
 *
 * 运行方式:
 *   pnpm run example:quickstart
 * 或:
 *   node --experimental-strip-types examples/01-erc20-basic.ts
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EVMEventLake } from "@evm-event-lake/node-sdk";

// 1. 定义 ABI（仅需包含需要同步和解码的 event）
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

// Base 主网 USDC 合约与公共 RPC 配置
const BASE_CHAIN_ID = 8_453;
const BASE_USDC_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const BASE_RPC_URL = "https://mainnet.base.org";
const SAMPLE_BLOCK = 48_625_053n;

async function main(): Promise<void> {
  // 使用临时目录存放 SQLite 数据库文件（生产环境可直接指定 sqlite://./data/usdc.db）
  const tempDir = await mkdtemp(join(tmpdir(), "eventlake-quickstart-"));
  const dbPath = join(tempDir, "usdc_events.db");

  console.log("=== 1. 初始化 EVMEventLake 实例 ===");
  const eventLake = await EVMEventLake.create({
    database: `sqlite://${dbPath}`,
    rpcUrls: [BASE_RPC_URL],
    chainId: BASE_CHAIN_ID,
    contractAddress: BASE_USDC_ADDRESS,
    abi: erc20Abi,
    startBlock: SAMPLE_BLOCK,
  });

  try {
    // 2. 查看当前本地同步状态（纯本地数据库读取，无需网络）
    const initialStatus = await eventLake.getSyncStatus();
    console.log("初始同步游标 nextBlock:", initialStatus.nextBlock);

    // 3. 执行单次同步：从 startBlock 同步到目标区块
    console.log(`\n=== 2. 开始同步区块 ${SAMPLE_BLOCK} 的日志 ===`);
    const updateResult = await eventLake.update({
      toBlock: SAMPLE_BLOCK,
    });

    console.log("同步完成:");
    console.log(`- 结果状态: ${updateResult.outcome}`);
    console.log(`- 成功存储日志数: ${updateResult.storedLogs}`);
    console.log(`- 解码成功事件数: ${updateResult.decodedLogs}`);
    console.log(`- 耗时: ${updateResult.durationMs}ms`);

    // 4. 查询已存储的 Transfer 事件（纯本地数据库查询，极速且无 RPC 额度消耗）
    console.log("\n=== 3. 查询存储的 Transfer 事件 (前 5 条) ===");
    const transfers = await eventLake.events.findMany({
      where: {
        eventName: "Transfer",
      },
      order: "ascending",
      limit: 5,
    });

    console.log(`共获取到 ${transfers.items.length} 条记录:`);
    for (const event of transfers.items) {
      const args = event.arguments as {
        from: string;
        to: string;
        value: bigint;
      };
      console.log(
        `  [Tx: ${event.transactionHash.slice(0, 10)}...] ` +
          `From: ${args.from.slice(0, 8)}... ` +
          `To: ${args.to.slice(0, 8)}... ` +
          `Value: ${(Number(args.value) / 1e6).toFixed(2)} USDC`,
      );
    }
  } finally {
    // 5. 显式关闭客户端，释放数据库句柄与连接
    await eventLake.close();
    await rm(tempDir, { force: true, recursive: true });
    console.log("\n已成功关闭客户端并清理临时资源。");
  }
}

await main();
