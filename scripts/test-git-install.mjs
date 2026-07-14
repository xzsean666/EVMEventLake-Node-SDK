import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const commit = (
  await runAndCapture("git", ["rev-parse", "HEAD"], repositoryRoot)
).trim();
const status = await runAndCapture(
  "git",
  ["status", "--porcelain"],
  repositoryRoot,
);
if (
  status.trim() !== "" &&
  process.env.EVM_EVENT_LAKE_ALLOW_DIRTY_GIT_INSTALL_TEST !== "true"
) {
  throw new Error(
    "Git install verification requires a clean repository so the tested commit matches the working tree",
  );
}

const localGitUrl = `git+${pathToFileURL(repositoryRoot).href}#${commit}`;
const installSpec = process.env.EVM_EVENT_LAKE_GIT_INSTALL_SPEC ?? localGitUrl;
if (!installSpec.includes("#")) {
  throw new Error("Git install specification must pin a tag or commit");
}

const consumerDirectory = await mkdtemp(
  join(tmpdir(), "evm-event-lake-git-install-"),
);
const keepTemporaryDirectory =
  process.env.EVM_EVENT_LAKE_KEEP_GIT_INSTALL_TEMP === "true";

try {
  await writeConsumerProject(consumerDirectory, installSpec);
  await run("pnpm", ["install"], consumerDirectory);
  await verifyInstalledCommit(consumerDirectory, commit, installSpec);
  await run("pnpm", ["run", "typecheck"], consumerDirectory);
  await run("pnpm", ["run", "smoke"], consumerDirectory);
  process.stdout.write(`Git install verification passed for ${installSpec}\n`);
} finally {
  if (keepTemporaryDirectory) {
    process.stdout.write(`Temporary consumer kept at ${consumerDirectory}\n`);
  } else {
    await rm(consumerDirectory, { force: true, recursive: true });
  }
}

async function writeConsumerProject(directory, dependencySpec) {
  const packageJson = {
    name: "evm-event-lake-git-install-smoke",
    private: true,
    type: "module",
    packageManager: "pnpm@10.12.1",
    scripts: {
      smoke: "node smoke.mjs",
      typecheck: "tsc --noEmit -p tsconfig.json",
    },
    dependencies: {
      "@evm-event-lake/node-sdk": dependencySpec,
    },
    devDependencies: {
      "@types/node": "24.13.3",
      typescript: "5.9.3",
    },
    pnpm: {
      onlyBuiltDependencies: ["better-sqlite3"],
    },
  };
  const tsconfig = {
    compilerOptions: {
      exactOptionalPropertyTypes: true,
      module: "NodeNext",
      moduleResolution: "NodeNext",
      noEmit: true,
      strict: true,
      target: "ES2022",
      types: ["node"],
    },
    include: ["typecheck.ts"],
  };
  await Promise.all([
    writeFile(
      join(directory, "package.json"),
      `${JSON.stringify(packageJson, null, 2)}\n`,
    ),
    writeFile(
      join(directory, "tsconfig.json"),
      `${JSON.stringify(tsconfig, null, 2)}\n`,
    ),
    writeFile(join(directory, "typecheck.ts"), typecheckSource),
    writeFile(join(directory, "smoke.mjs"), smokeSource),
  ]);
}

async function verifyInstalledCommit(
  directory,
  expectedCommit,
  dependencySpec,
) {
  const lockfile = await readFile(join(directory, "pnpm-lock.yaml"), "utf8");
  if (
    dependencySpec.startsWith("git+file:") &&
    !lockfile.includes(expectedCommit)
  ) {
    throw new Error(
      "Consumer lockfile does not contain the expected Git commit",
    );
  }
}

function run(command, arguments_, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, arguments_, { cwd, stdio: "inherit" });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(
          `${command} ${arguments_.join(" ")} failed with ${
            signal === null ? `exit code ${String(code)}` : `signal ${signal}`
          }`,
        ),
      );
    });
  });
}

function runAndCapture(command, arguments_, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, arguments_, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise(stdout);
        return;
      }
      rejectPromise(
        new Error(
          `${command} ${arguments_.join(" ")} failed with ${
            signal === null ? `exit code ${String(code)}` : `signal ${signal}`
          }: ${stderr.trim()}`,
        ),
      );
    });
  });
}

const typecheckSource = `import {
  EVMEventLake,
  type EVMEventLakeOptions,
  type EventQuery,
  type SyncStatus,
  type UpdateResult,
} from "@evm-event-lake/node-sdk";

const abi = [{
  anonymous: false,
  inputs: [{ indexed: true, name: "owner", type: "address" }],
  name: "OwnerChanged",
  type: "event",
}] as const;

const options: EVMEventLakeOptions = {
  abi,
  chainId: 1,
  contractAddress: "0x0000000000000000000000000000000000000001",
  database: "sqlite://events.db",
  rpcUrls: ["http://127.0.0.1:1"],
  startBlock: 100n,
};
const query: EventQuery = { where: { eventName: "OwnerChanged" } };
const acceptStatus = (status: SyncStatus): bigint => status.nextBlock;
const acceptUpdate = (result: UpdateResult): number => result.storedLogs;

void EVMEventLake.create;
void options;
void query;
void acceptStatus;
void acceptUpdate;
`;

const smokeSource = `import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as sdk from "@evm-event-lake/node-sdk";

const directory = await mkdtemp(join(tmpdir(), "evm-event-lake-consumer-"));
try {
  if (typeof sdk.EVMEventLake !== "function") {
    throw new Error("Package root does not export EVMEventLake");
  }
  if ("RpcPool" in sdk || "createStorageAdapter" in sdk) {
    throw new Error("Package root exposes an internal implementation module");
  }
  const database = join(directory, "events.db");
  const client = await sdk.EVMEventLake.create({
    abi: [{
      anonymous: false,
      inputs: [{ indexed: true, name: "owner", type: "address" }],
      name: "OwnerChanged",
      type: "event",
    }],
    chainId: 1,
    contractAddress: "0x0000000000000000000000000000000000000001",
    database: \`sqlite://\${database}\`,
    rpcUrls: ["http://127.0.0.1:1"],
    startBlock: 100n,
  });
  try {
    const status = await client.getSyncStatus();
    const events = await client.events.findMany();
    if (status.nextBlock !== 100n || events.items.length !== 0) {
      throw new Error("Installed package SQLite smoke result is invalid");
    }
  } finally {
    await client.close();
  }
} finally {
  await rm(directory, { force: true, recursive: true });
}
`;
