import {
  EVMEventLake,
  type EVMEventLakeOptions,
  type EventQuery,
  type EventRecord,
  type SdkLogger,
  type SyncStatus,
  type UpdateProgressCallback,
  type UpdateResult,
} from "@evm-event-lake/node-sdk";

const transferAbi = [
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

const logger: SdkLogger = {
  log(event): void {
    void event.event;
  },
};
const onProgress: UpdateProgressCallback = (event): void => {
  void event.stage;
};
const options: EVMEventLakeOptions = {
  abi: transferAbi,
  chainId: 1,
  contractAddress: "0x0000000000000000000000000000000000000010",
  database: "sqlite://events.db",
  observability: { logger, onProgress },
  rpcUrls: ["http://127.0.0.1:8545"],
  startBlock: 100n,
};
const query: EventQuery = {
  limit: 100,
  order: "ascending",
  where: {
    eventSignature: "Transfer(address,address,uint256)",
    indexedParameters: {
      to: "0x0000000000000000000000000000000000000002",
    },
  },
};

async function exercisePublicTypes(): Promise<void> {
  const eventLake = await EVMEventLake.create(options);
  try {
    const status: SyncStatus = await eventLake.getSyncStatus();
    const update: UpdateResult = await eventLake.update({ toBlock: 100n });
    const first: EventRecord | null = await eventLake.events.findFirst(query);
    void status;
    void update;
    void first;
  } finally {
    await eventLake.close();
  }
}

void exercisePublicTypes;
