import { spawn } from "node:child_process";
import {
  copyFile,
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exampleRoot = join(repositoryRoot, "example");
const githubMode = process.argv.includes("--github");

async function main() {
  const commit = (
    await runAndCapture("git", ["rev-parse", "HEAD"], repositoryRoot)
  ).trim();
  const initialStatus = await runAndCapture(
    "git",
    ["status", "--porcelain"],
    repositoryRoot,
  );
  if (
    initialStatus.trim() !== "" &&
    process.env.EVM_EVENT_LAKE_ALLOW_DIRTY_GIT_INSTALL_TEST !== "true"
  ) {
    throw new Error(
      "Git install verification requires a clean repository so the tested commit matches the working tree",
    );
  }

  const examplePackage = JSON.parse(
    await readFile(join(exampleRoot, "package.json"), "utf8"),
  );
  const documentedGithubSpec =
    examplePackage.dependencies?.["@evm-event-lake/node-sdk"];
  if (typeof documentedGithubSpec !== "string") {
    throw new Error("The standalone example must declare the SDK dependency");
  }

  const localGitUrl = `git+${pathToFileURL(repositoryRoot).href}#${commit}`;
  const installSpec =
    process.env.EVM_EVENT_LAKE_GIT_INSTALL_SPEC ??
    (githubMode ? documentedGithubSpec : localGitUrl);
  validateInstallSpec(installSpec, githubMode);
  const expectedCommit = await resolveExpectedCommit(installSpec, commit);

  const consumerDirectory = await mkdtemp(
    join(tmpdir(), "evm-event-lake-git-install-"),
  );
  const keepTemporaryDirectory =
    process.env.EVM_EVENT_LAKE_KEEP_GIT_INSTALL_TEMP === "true";

  try {
    await copyConsumerProject(consumerDirectory, examplePackage, installSpec);
    await run(
      "pnpm",
      ["install", "--frozen-lockfile=false"],
      consumerDirectory,
    );
    await verifyInstalledCommit(consumerDirectory, expectedCommit);
    await run("pnpm", ["run", "verify"], consumerDirectory);
    process.stdout.write(
      `Git install verification passed for ${installSpec} at ${expectedCommit}\n`,
    );
  } finally {
    if (keepTemporaryDirectory) {
      process.stdout.write(`Temporary consumer kept at ${consumerDirectory}\n`);
    } else {
      await rm(consumerDirectory, { force: true, recursive: true });
    }
    const finalStatus = await runAndCapture(
      "git",
      ["status", "--porcelain"],
      repositoryRoot,
    );
    if (finalStatus !== initialStatus) {
      throw new Error(
        "Standalone consumer verification changed the SDK repository worktree",
      );
    }
  }
}

async function copyConsumerProject(directory, examplePackage, dependencySpec) {
  const packageJson = {
    ...examplePackage,
    dependencies: {
      ...examplePackage.dependencies,
      "@evm-event-lake/node-sdk": dependencySpec,
    },
  };
  await Promise.all([
    writeFile(
      join(directory, "package.json"),
      `${JSON.stringify(packageJson, null, 2)}\n`,
    ),
    copyFile(
      join(exampleRoot, "pnpm-workspace.yaml"),
      join(directory, "pnpm-workspace.yaml"),
    ),
    copyFile(
      join(exampleRoot, "tsconfig.json"),
      join(directory, "tsconfig.json"),
    ),
    copyFile(
      join(exampleRoot, "typecheck.ts"),
      join(directory, "typecheck.ts"),
    ),
    cp(join(exampleRoot, "test"), join(directory, "test"), { recursive: true }),
  ]);
}

function validateInstallSpec(installSpec, requireGithub) {
  const separatorIndex = installSpec.lastIndexOf("#");
  if (separatorIndex < 0 || separatorIndex === installSpec.length - 1) {
    throw new Error("Git install specification must pin a tag or commit");
  }
  const reference = installSpec.slice(separatorIndex + 1);
  if (!isReleaseTag(reference) && !isFullCommit(reference)) {
    throw new Error(
      "Git install specification must use a semantic version tag or full 40-character commit SHA",
    );
  }
  if (requireGithub && !isGithubSpec(installSpec)) {
    throw new Error(
      "GitHub install verification requires a github.com reference",
    );
  }
}

async function resolveExpectedCommit(installSpec, localCommit) {
  const explicitExpectedCommit = process.env.EVM_EVENT_LAKE_EXPECTED_COMMIT;
  if (explicitExpectedCommit !== undefined) {
    if (!isFullCommit(explicitExpectedCommit)) {
      throw new Error(
        "EVM_EVENT_LAKE_EXPECTED_COMMIT must be a full 40-character commit SHA",
      );
    }
    return explicitExpectedCommit.toLowerCase();
  }

  const reference = installSpec.slice(installSpec.lastIndexOf("#") + 1);
  if (isFullCommit(reference)) return reference.toLowerCase();
  if (!isGithubSpec(installSpec)) return localCommit.toLowerCase();

  const repositoryUrl = githubRepositoryUrl(installSpec);
  const output = await runAndCapture(
    "git",
    [
      "ls-remote",
      repositoryUrl,
      `refs/tags/${reference}`,
      `refs/tags/${reference}^{}`,
    ],
    repositoryRoot,
  );
  const matches = output
    .trim()
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => line.split(/\s+/, 2));
  const peeled = matches.find(([, name]) => name?.endsWith("^{}"));
  const selected = peeled ?? matches[0];
  const resolvedCommit = selected?.[0];
  if (resolvedCommit === undefined || !isFullCommit(resolvedCommit)) {
    throw new Error(`GitHub tag ${reference} does not resolve to a commit`);
  }
  return resolvedCommit.toLowerCase();
}

function githubRepositoryUrl(installSpec) {
  if (installSpec.startsWith("github:")) {
    const repository = installSpec.slice("github:".length).split("#", 1)[0];
    return `https://github.com/${repository}.git`;
  }
  return installSpec
    .slice(installSpec.startsWith("git+") ? "git+".length : 0)
    .split("#", 1)[0];
}

function isGithubSpec(installSpec) {
  return (
    installSpec.startsWith("github:") ||
    /^git\+https:\/\/github\.com\//.test(installSpec) ||
    /^https:\/\/github\.com\//.test(installSpec)
  );
}

function isReleaseTag(reference) {
  return /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(
    reference,
  );
}

function isFullCommit(reference) {
  return /^[0-9a-f]{40}$/i.test(reference);
}

async function verifyInstalledCommit(directory, expectedCommit) {
  const lockfile = await readFile(join(directory, "pnpm-lock.yaml"), "utf8");
  if (!lockfile.toLowerCase().includes(expectedCommit.toLowerCase())) {
    throw new Error(
      `Consumer lockfile does not contain expected Git commit ${expectedCommit}`,
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

await main();
