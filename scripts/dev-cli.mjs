import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);

function exitOnFailure(child) {
  if (child.error) {
    console.error(child.error.message);
    process.exit(1);
  }
  if (child.status !== 0) {
    process.exit(child.status ?? 1);
  }
}

function runNpmBuild() {
  const npmArgs = ["run", "-w", "@nexgen/canvas-sdk", "build"];
  let child = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", npmArgs, {
    stdio: "inherit"
  });

  if (child.error && process.platform === "win32") {
    child = spawnSync("cmd.exe", ["/d", "/s", "/c", "npm", ...npmArgs], {
      stdio: "inherit"
    });
  }

  exitOnFailure(child);
}

function runCli() {
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", "apps/cli/src/cli.ts", ...args],
    { stdio: "inherit" }
  );
  exitOnFailure(child);
}

runNpmBuild();
runCli();
