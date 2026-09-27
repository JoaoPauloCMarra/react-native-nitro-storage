import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Host-only Memory measurements; these do not measure native Disk/JSI latency.
const source = resolve(
  import.meta.dir,
  "../packages/react-native-nitro-storage/src/index.web.ts",
);
const { storage, StorageScope } = await import(pathToFileURL(source).href);
const smoke = process.argv.includes("--smoke");
const includeSpecial = !process.argv.includes("--ordinary");
const batches = smoke ? 1 : 5;
const samples = smoke ? 1 : 30;
const rows = [];
for (const keys of smoke ? [1000] : [1000, 10000, 100000]) {
  storage.clear(StorageScope.Memory);
  for (let i = 0; i < keys; i++)
    storage.setString(`fixture::${i}`, `value:${i}`, StorageScope.Memory);
  if (includeSpecial)
    storage.setString("__proto__", "special", StorageScope.Memory);
  const validate = (
    result: Record<string, unknown>,
    includeSpecial: boolean,
  ) => {
    if (Object.keys(result).length !== keys + Number(includeSpecial))
      throw new Error("Wrong enumeration key count");
    for (let i = 0; i < keys; i++) {
      const key = `fixture::${i}`;
      if (!Object.hasOwn(result, key) || result[key] !== `value:${i}`)
        throw new Error(`Wrong enumeration entry: ${key}`);
    }
    if (
      includeSpecial &&
      (!Object.hasOwn(result, "__proto__") || result.__proto__ !== "special")
    )
      throw new Error("Wrong special-key enumeration entry");
  };
  for (const operation of ["getAll", "getByPrefix"] as const) {
    const run = () =>
      operation === "getAll"
        ? storage.getAll(StorageScope.Memory)
        : storage.getByPrefix("fixture::", StorageScope.Memory);
    validate(run(), operation === "getAll" && includeSpecial);
    for (let warmup = 0; warmup < 10; warmup++) run();
    for (let batch = 0; batch < batches; batch++) {
      const durations = [];
      for (let sample = 0; sample < samples; sample++) {
        const start = performance.now();
        const result = run();
        durations.push(performance.now() - start);
        // Validate all output after stopping the timer.
        validate(result, operation === "getAll" && includeSpecial);
      }
      durations.sort((a, b) => a - b);
      rows.push({
        operation,
        keys,
        batch,
        samples,
        medianMs: durations[Math.floor(samples / 2)],
        p95Ms: durations[Math.min(samples - 1, Math.ceil(samples * 0.95) - 1)],
      });
    }
  }
}
console.log(
  JSON.stringify(
    {
      evidence: "host-memory-warm-only",
      runtime: `Bun ${Bun.version}`,
      fixture: includeSpecial ? "enumeration-v2" : "enumeration-v2-ordinary",
      coreHash: createHash("sha256")
        .update(readFileSync(resolve(source, "../storage-core.ts")))
        .digest("hex"),
      peakRssBytes: process.resourceUsage().maxRSS * 1024,
      rows,
    },
    null,
    2,
  ),
);
