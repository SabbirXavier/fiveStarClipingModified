import { execSync } from "node:child_process";

console.log("Stopping Fivestar...");

try {
  if (process.platform === "win32") {
    execSync(
      `powershell -NoProfile -Command "$ports = @(5177); $conns = Get-NetTCPConnection -LocalPort 5177 -State Listen -ErrorAction SilentlyContinue; foreach ($c in $conns) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }; $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*dist/server.mjs*' -or $_.CommandLine -like '*dist\\server.mjs*' }; foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { stdio: "inherit" }
    );
  } else {
    execSync(`lsof -ti:5177 | xargs -r kill -9`, { stdio: "inherit" });
  }
  console.log("All Fivestar processes stopped.");
} catch (err) {
  console.log("Fivestar was not running or has already stopped.");
}
