import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

for (const ordinary of [false, true]) {
  test(`enumeration smoke validates ${ordinary ? "ordinary" : "special-key"} output and finite timings`, () => {
    const result = spawnSync(
      process.execPath,
      [
        join(import.meta.dir, "benchmark-enumeration.ts"),
        "--smoke",
        ...(ordinary ? ["--ordinary"] : []),
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.fixture).toBe(
      ordinary ? "enumeration-v2-ordinary" : "enumeration-v2",
    );
    expect(report.evidence).toBe("host-memory-warm-only");
    expect(report.coreHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.rows).toHaveLength(2);
    for (const row of report.rows) {
      expect(row.samples).toBe(1);
      expect(Number.isFinite(row.medianMs) && row.medianMs >= 0).toBe(true);
      expect(Number.isFinite(row.p95Ms) && row.p95Ms >= row.medianMs).toBe(
        true,
      );
    }
  });
}
