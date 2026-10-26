// Bash 도구가 실행되기 전에 호출된다. main 브랜치로 향하는 git push를 막는다.
import { execSync } from "node:child_process";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const { tool_input: toolInput, cwd } = JSON.parse(raw);
const command = toolInput?.command ?? "";

const push = command.match(/\bgit\s+push\b(.*)/);
if (!push) process.exit(0);

const args = push[1].split(/[;&|]/)[0].trim().split(/\s+/).filter((arg) => arg && !arg.startsWith("-"));
const refspecs = args.slice(1);
const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd }).toString().trim();
const targetsMain =
  refspecs.length === 0
    ? currentBranch === "main"
    : refspecs.some((ref) => ref === "main" || ref.endsWith(":main") || (ref === "HEAD" && currentBranch === "main"));

if (targetsMain) {
  console.error("main 브랜치에는 직접 push할 수 없습니다. 작업 브랜치를 만들어 push하고 PR로 리뷰를 받으십시오.");
  process.exit(2);
}
