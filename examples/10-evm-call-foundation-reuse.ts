/**
 * 10-evm-call-foundation-reuse.ts
 *
 * 底座能力复用示例 (Foundation SDK Re-use):
 * 展示下游项目如何直接复用 `@evm-event-lake/node-sdk` 内置重导出的 `evm-call` 基础设施，
 * 无需在自身项目中额外安装或声明 `evm-call`，实现零冲突、零双重安装的直接复用。
 *
 * 运行方式:
 *   pnpm run example:evm-call
 * 或:
 *   node --experimental-strip-types examples/10-evm-call-foundation-reuse.ts
 */

// 方式 1: 命名空间导入 (Namespace Import)
import { EvmCall } from "@evm-event-lake/node-sdk";

// 方式 2: 子路径导入 (Subpath Import - 推荐)
import {
  createEvmCallClient,
  BUILTIN_BASE_RPCS,
} from "@evm-event-lake/node-sdk/evm-call";

async function main(): Promise<void> {
  console.log("=== 1. 验证 evm-call 底座库版本与内置节点列表 ===");
  console.log(`evm-call 内部版本: ${EvmCall.VERSION}`);
  console.log(`Base 内置官方/公共 RPC 节点数: ${BUILTIN_BASE_RPCS.length}`);
  const primaryRpc = BUILTIN_BASE_RPCS[0]?.url ?? "https://mainnet.base.org";
  console.log(`首选节点: ${primaryRpc}`);

  console.log("\n=== 2. 复用底座 resolveChainId 并创建高可用 RPC 客户端 ===");
  const chainId = EvmCall.resolveChainId("base");
  console.log(`网络别名 'base' 映射 Chain ID: ${chainId}`);

  const client = createEvmCallClient({
    chainId,
    customRpcUrls: [primaryRpc],
  });

  await client.init();

  console.log("正在使用 evm-call 底座查询 Base 主网最新区块高度...");
  const latestBlockResult = await client.findLatestBlockNumber();
  console.log(
    `成功获取 Base 主网当前最新区块: ${latestBlockResult.blockNumber} (响应节点: ${latestBlockResult.rpcEndpointId})`,
  );

  client.close();

  console.log("\n=== 结论 ===");
  console.log("下游项目只需安装 @evm-event-lake/node-sdk 即可同时拥有:");
  console.log("1. 事件持久化与增量同步引擎 (EVMEventLake)");
  console.log(
    "2. 工业级多节点故障转移、重试池与多调用底座 (EvmCallClient / evm-call)",
  );
}

main().catch((error: unknown) => {
  console.error("运行失败:", error);
  process.exit(1);
});
