// Claude가 응답을 마치려 할 때 호출된다. 검사를 통과하지 못하면 작업을 끝내지 못하게 한다.
import { execSync } from "node:child_process";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const { cwd } = JSON.parse(raw);
const run = (cmd) => execSync(cmd, { cwd, stdio: "pipe" }).toString();

const changed = new Set(
  [run("git diff --name-only origin/main...HEAD"), run("git diff --name-only HEAD"), run("git ls-files --others --exclude-standard")]
    .join("\n")
    .split("\n")
    .filter(Boolean),
);
if (changed.size === 0) process.exit(0);

const failures = [];
for (const [name, cmd] of [["타입 검사", "npm run typecheck"], ["테스트", "npm test"]]) {
  try {
    run(cmd);
  } catch {
    failures.push(`${name}(${cmd})가 실패했습니다.`);
  }
}
if ([...changed].some((file) => file.startsWith("src/http/routes/")) && !changed.has("README.md")) {
  failures.push("API 라우트가 바뀌었지만 README.md의 API 목록이 갱신되지 않았습니다.");
}
if (failures.length > 0) {
  console.error(["품질 게이트를 통과하지 못했습니다.", ...failures].join("\n"));
  process.exit(2);
}
