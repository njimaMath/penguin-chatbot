// 回帰ランナー: サーバを PENGUIN_TEST_NOW 固定で起動し、20問を POST /chat して緩採点する。
// fastpath問はLLM不要で常に検証。llm問は OPENROUTER_API_KEY が無ければ skip。
import fs from "fs";
import { spawn } from "child_process";

const cfg = JSON.parse(fs.readFileSync(new URL("./regression.json", import.meta.url), "utf-8"));
const PORT = 3998;
const hasKey = Boolean(process.env.OPENROUTER_API_KEY);

const server = spawn("node", ["server.js"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, PORT: String(PORT), PENGUIN_TEST_NOW: cfg.now },
  stdio: "ignore",
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function judge(c, reply) {
  const text = String(reply || "");
  if (c.expect_absent) return c.expect_absent.every((w) => !text.includes(w));
  if (c.expect_contains) return c.expect_contains.some((w) => text.includes(w));
  return true;
}

try {
  await sleep(2500);
  let pass = 0, fail = 0, skip = 0;
  for (const c of cfg.cases) {
    if (c.type === "llm" && !hasKey) { skip += 1; console.log(`  skip[${c.id}] (要APIキー): ${c.q}`); continue; }
    const res = await fetch(`http://localhost:${PORT}/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: c.q }),
    });
    const data = await res.json();
    const ok = judge(c, data.reply);
    if (ok) { pass += 1; console.log(`  ok[${c.id}] ${c.q}`); }
    else { fail += 1; console.error(`  NG[${c.id}] ${c.q}\n     → ${String(data.reply).slice(0, 120)}`); }
  }
  console.log(`\n${fail === 0 ? "✅" : "❌"} pass=${pass} fail=${fail} skip=${skip}${hasKey ? "" : " (OPENROUTER_API_KEY未設定のためllm問はskip)"}`);
  process.exitCode = fail === 0 ? 0 : 1;
} finally {
  server.kill();
}
