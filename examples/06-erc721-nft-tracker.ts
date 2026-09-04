/**
 * 06-erc721-nft-tracker.ts
 *
 * NFT (ERC-721) 铸造与流转追踪示例：
 * ERC-721 的 Transfer 事件与 ERC-20 关键差异在于：
 *   event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)
 * 其 tokenId 是 indexed 参数（对应 topic3），因此可以通过 indexedParameters 极速精准过滤！
 *
 * 本示例演示：
 * 1. 定义 ERC-721 Transfer 与 Approval 事件 ABI
 * 2. 追踪 NFT 铸造（Mint）事件：from 地址为零地址 (0x0000...0000)
 * 3. 追踪特定 tokenId 的全部历史流转记录 (indexedParameters: { tokenId })
 * 4. 追踪特定买家/地址接收的所有 NFT (indexedParameters: { to })
 *
 * 运行方式:
 *   pnpm run example:nft
 * 或:
 *   node --experimental-strip-types examples/06-erc721-nft-tracker.ts
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EVMEventLake } from "@evm-event-lake/node-sdk";

// ERC-721 ABI: 注意 tokenId 是 indexed: true
const erc721Abi = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: true, name: "tokenId", type: "uint256" },
    ],
    name: "Transfer",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "owner", type: "address" },
      { indexed: true, name: "approved", type: "address" },
      { indexed: true, name: "tokenId", type: "uint256" },
    ],
    name: "Approval",
    type: "event",
  },
] as const;

// 零地址常用于判定 NFT 铸造 (Mint)
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// 可配置为任意链与 NFT 合约（例如以太坊主网或 Base 上的 NFT 项目）
const CHAIN_ID = Number(process.env.CHAIN_ID ?? "8453");
const RPC_URL = process.env.RPC_URL ?? "https://mainnet.base.org";
const NFT_CONTRACT_ADDRESS =
  process.env.NFT_ADDRESS ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Base USDC 或自定义 NFT
const START_BLOCK = BigInt(process.env.START_BLOCK ?? "48625053");

async function main(): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), "eventlake-nft-"));
  const dbPath = join(tempDir, "nft_events.db");

  console.log("=== 1. 初始化 ERC-721 NFT 事件监听器 ===");
  const eventLake = await EVMEventLake.create({
    database: `sqlite://${dbPath}`,
    rpcUrls: [RPC_URL],
    chainId: CHAIN_ID,
    contractAddress: NFT_CONTRACT_ADDRESS,
    abi: erc721Abi,
    startBlock: START_BLOCK,
  });

  try {
    console.log(`\n=== 2. 同步区块 ${START_BLOCK} ===`);
    const updateResult = await eventLake.update({ toBlock: START_BLOCK });
    console.log(
      `同步完成: 抓取日志=${updateResult.fetchedLogs}, 存储日志=${updateResult.storedLogs}, 解码=${updateResult.decodedLogs}`,
    );

    // -------------------------------------------------------------
    // 场景 A: 查找所有铸造事件 (Mints: from == ZERO_ADDRESS)
    // -------------------------------------------------------------
    console.log("\n=== 场景 A: 追踪铸造 (Mint) 事件 (from = 0x000...000) ===");
    const mintEvents = await eventLake.events.findMany({
      where: {
        eventSignature: "Transfer(address,address,uint256)",
        indexedParameters: {
          from: ZERO_ADDRESS,
        },
      },
      limit: 10,
    });
    console.log(`找到 ${mintEvents.items.length} 笔铸造事件`);

    // -------------------------------------------------------------
    // 场景 B: 按指定 tokenId 精准追踪流转历史
    // -------------------------------------------------------------
    console.log("\n=== 场景 B: 追踪指定 TokenId 的完整流转历史 ===");
    const targetTokenId = 1n; // 追踪 Token #1
    const tokenHistory = await eventLake.events.findMany({
      where: {
        eventSignature: "Transfer(address,address,uint256)",
        indexedParameters: {
          tokenId: targetTokenId,
        },
      },
      order: "ascending", // 从铸造到最新持有人
    });
    console.log(
      `TokenId #${targetTokenId} 历史流转次数: ${tokenHistory.items.length}`,
    );

    // -------------------------------------------------------------
    // 场景 C: 追踪指定接收地址 (to) 的 NFT
    // -------------------------------------------------------------
    console.log("\n=== 场景 C: 追踪指定接收地址买入/接收的 NFT ===");
    const sampleRecipient = "0xCf40563a1159bf8B8126255E5866E1A29469423C";
    const receivedNfts = await eventLake.events.findMany({
      where: {
        eventSignature: "Transfer(address,address,uint256)",
        indexedParameters: {
          to: sampleRecipient,
        },
      },
      order: "descending",
    });
    console.log(
      `地址 ${sampleRecipient} 接收到的 NFT 笔数: ${receivedNfts.items.length}`,
    );
  } finally {
    await eventLake.close();
    await rm(tempDir, { force: true, recursive: true });
    console.log("\n客户端已安全关闭。");
  }
}

await main();
