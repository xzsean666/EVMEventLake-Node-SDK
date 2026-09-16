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
const SAMPLE_BLOCK = 48_625_050n;

let lake: EVMEventLake | null = null;

const btnInit = document.getElementById("btn-init") as HTMLButtonElement;
const btnStatus = document.getElementById("btn-status") as HTMLButtonElement;
const btnSync = document.getElementById("btn-sync") as HTMLButtonElement;
const btnQuery = document.getElementById("btn-query") as HTMLButtonElement;
const btnClose = document.getElementById("btn-close") as HTMLButtonElement;
const output = document.getElementById("output") as HTMLPreElement;

const valStartBlock = document.getElementById("val-start-block")!;
const valNextBlock = document.getElementById("val-next-block")!;
const valSyncedThrough = document.getElementById("val-synced-through")!;
const valHasLease = document.getElementById("val-has-lease")!;

function log(message: string): void {
  const timestamp = new Date().toLocaleTimeString();
  output.textContent = `[${timestamp}] ${message}\n` + output.textContent;
}

function updateUiState(): void {
  const isReady = lake !== null;
  btnInit.disabled = isReady;
  btnStatus.disabled = !isReady;
  btnSync.disabled = !isReady;
  btnQuery.disabled = !isReady;
  btnClose.disabled = !isReady;
}

async function handleInit(): Promise<void> {
  try {
    log(
      "Initializing EVMEventLake in browser with database idb://base-usdc-lake...",
    );
    lake = await EVMEventLake.create({
      abi: erc20Abi,
      chainId: BASE_CHAIN_ID,
      contractAddress: BASE_USDC_ADDRESS,
      database: "idb://base-usdc-lake",
      observability: {
        onProgress: (event) => {
          log(`Progress stage: ${event.stage}`);
        },
      },
      rpcUrls: [BASE_RPC_URL],
      startBlock: SAMPLE_BLOCK,
    });

    log(
      "Client initialized successfully! Browser IndexedDB ObjectStores are ready.",
    );
    updateUiState();
    await handleStatus();
  } catch (err) {
    log(`Initialization error: ${String(err)}`);
  }
}

async function handleStatus(): Promise<void> {
  if (!lake) return;
  try {
    const status = await lake.getSyncStatus();
    valStartBlock.textContent = status.startBlock.toString();
    valNextBlock.textContent = status.nextBlock.toString();
    valSyncedThrough.textContent =
      status.syncedThroughBlock !== null
        ? status.syncedThroughBlock.toString()
        : "None";
    valHasLease.textContent = status.hasActiveLease ? "Yes" : "No";
    log(
      `Sync status: nextBlock=${status.nextBlock}, syncedThrough=${status.syncedThroughBlock}`,
    );
  } catch (err) {
    log(`Status refresh error: ${String(err)}`);
  }
}

async function handleSync(): Promise<void> {
  if (!lake) return;
  try {
    const status = await lake.getSyncStatus();
    const targetBlock = status.nextBlock + 3n;
    log(`Running update() from block ${status.nextBlock} to ${targetBlock}...`);
    const result = await lake.update({ toBlock: targetBlock });
    log(
      `Sync complete! Outcome: ${result.outcome}, storedLogs: ${result.storedLogs}, duration: ${result.durationMs}ms`,
    );
    await handleStatus();
  } catch (err) {
    log(`Sync error: ${String(err)}`);
  }
}

async function handleQuery(): Promise<void> {
  if (!lake) return;
  try {
    log("Querying cached events from IndexedDB (no network I/O)...");
    const result = await lake.events.findMany({
      limit: 5,
      order: "descending",
    });
    log(`Found ${result.items.length} stored events:`);
    for (const item of result.items) {
      log(
        `  Block #${item.blockNumber} [Tx: ${item.transactionHash.slice(0, 10)}...] ${item.eventName}`,
      );
    }
  } catch (err) {
    log(`Query error: ${String(err)}`);
  }
}

async function handleClose(): Promise<void> {
  if (!lake) return;
  try {
    await lake.close();
    lake = null;
    log("EVMEventLake client closed and IndexedDB handle released.");
    updateUiState();
  } catch (err) {
    log(`Close error: ${String(err)}`);
  }
}

btnInit.addEventListener("click", () => {
  void handleInit();
});
btnStatus.addEventListener("click", () => {
  void handleStatus();
});
btnSync.addEventListener("click", () => {
  void handleSync();
});
btnQuery.addEventListener("click", () => {
  void handleQuery();
});
btnClose.addEventListener("click", () => {
  void handleClose();
});
