/**
 * 04-postgresql-storage.ts
 *
 * 生产环境 PostgreSQL 存储与读写分离架构示例：
 * SQLite 适用于单进程嵌入式或开发调试，而 PostgreSQL 适用于：
 * 1. 多个应用实例、容器或微服务共享事件数据湖
 * 2. 读写分离架构：专用后台 Worker 负责同步，多个 Web/API 节点只读查询（免 RPC 消耗）
 * 3. 分布式排他租约（Lease）：SDK 基于 PostgreSQL 行锁保障同一合约同一时刻仅由一个 Worker 执行同步
 *
 * 运行方式:
 *   DATABASE_URL="postgresql://user:password@localhost:5432/my_event_lake" pnpm run example:postgres
 * 或:
 *   node --experimental-strip-types examples/04-postgresql-storage.ts
 */

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

// 从环境变量读取 PostgreSQL 连接串，若未提供则展示配置说明
const databaseUrl = process.env.DATABASE_URL;

async function main(): Promise<void> {
  console.log("=== PostgreSQL 生产配置与架构说明 ===");

  if (!databaseUrl || !databaseUrl.startsWith("postgresql://")) {
    console.log(`
[提示] 未检测到 DATABASE_URL 环境变量。
要连接真实的 PostgreSQL 数据库并运行本示例，请先准备数据库并执行：
  export DATABASE_URL="postgresql://username:password@127.0.0.1:5432/eventlake"
  pnpm run example:postgres

--- 核心架构与配置要点 ---
1. 连接串格式:
   database: "postgresql://<user>:<password>@<host>:<port>/<dbname>"

2. 自动迁移 (Schema Migrations):
   - EVMEventLake 在首次 create() 时会自动在目标数据库上应用版本化的向前迁移脚本。
   - 包含 targets, checkpoints, leases, logs, log_parameters 表及复合索引。
   - 不需要手动执行 SQL 建表脚本。

3. 读写分离架构 (Worker vs API Server):
   - 【同步服务 (Sync Worker)】:
     配置完整 RPC 与 PostgreSQL 连接，定期调用 eventLake.update()。
     SDK 内部会自动获取租约（Lease），若同一时刻有另一 Worker 尝试同步，
     会抛出 SynchronizationLockedError，杜绝重复同步与数据竞态。

   - 【查询 API 服务 (API Servers)】:
     仅需配置相同的 database: "postgresql://..."，rpcUrls 可以为空数组！
     直接调用 eventLake.events.findMany() / findFirst()。
     完全不依赖外部 RPC 节点，无 RPC 速率限制，极速响应前端查询。

4. 租约配置 (Lease Configuration):
   synchronization: {
     leaseDurationMs: 60_000, // 租约默认 60 秒，同步期间会自动续租
   }
`);
    return;
  }

  console.log(
    `\n正在连接 PostgreSQL: ${databaseUrl.replace(/:[^:@]+@/, ":****@")}`,
  );

  // 1. 初始化客户端（连接 PostgreSQL）
  const eventLake = await EVMEventLake.create({
    database: databaseUrl,
    rpcUrls: [BASE_RPC_URL],
    chainId: BASE_CHAIN_ID,
    contractAddress: BASE_USDC_ADDRESS,
    abi: erc20Abi,
    startBlock: SAMPLE_BLOCK,
    synchronization: {
      leaseDurationMs: 30_000, // 30 秒分布式租约
    },
  });

  try {
    // 2. 查看当前状态
    const status = await eventLake.getSyncStatus();
    console.log("PostgreSQL 存储当前游标 nextBlock:", status.nextBlock);

    // 3. 执行单次同步
    console.log(`正在同步区块 ${SAMPLE_BLOCK}...`);
    const updateResult = await eventLake.update({ toBlock: SAMPLE_BLOCK });
    console.log(`同步完成: 新增 ${updateResult.storedLogs} 条日志`);

    // 4. 查询数据
    const transfers = await eventLake.events.findMany({
      where: { eventName: "Transfer" },
      limit: 3,
    });
    console.log(`成功从 PostgreSQL 查询到 ${transfers.items.length} 条记录:`);
    for (const item of transfers.items) {
      console.log(
        `  - Tx: ${item.transactionHash} (LogIndex: ${item.logIndex})`,
      );
    }
  } finally {
    // 5. 释放连接池与锁
    await eventLake.close();
    console.log("PostgreSQL 连接池已安全关闭。");
  }
}

await main();
