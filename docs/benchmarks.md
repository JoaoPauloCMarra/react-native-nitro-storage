# Benchmarks

Benchmarks are release checks, not product promises. Use them to catch regressions on the local machine and CI image used by this repo.

Run from the repo root:

```sh
bun run build
bun run benchmark
```

## Scope: Web Only

`benchmark` loads only this package's `lib/commonjs/index.web.js` entry and measures it against a private localStorage implementation created for that process. The `web:disk-scope:` and `web:secure-scope:` labels describe web scopes, not native Disk or Secure storage.

Native Disk/Secure baselines require a device or simulator run and are not part of this gate. Do not compare these numbers against native storage.

## Interpreting Results

- Each run reports the package name/version, runtime, architecture, warmups,
  sample count, median, and p95. It does not use another package's artifact or
  ambient browser storage.
- Compare results on the same machine and Node/Bun version.
- The benchmark uses seven measured samples after two warmups and reports the
  median for throughput. It does not select the best sample.
- Treat large deltas as a prompt to inspect recent storage-runtime, serialization, cache, or event changes.
- Do not compare web backend numbers against native secure storage numbers; they measure different systems.

## Release Checklist

Before publishing, run the full release gate:

```sh
bun run release:preflight
```

It runs `check:ci` (including the benchmark), the example checks, the package
audit, and the publish dry run.

## 2026-09-27 Memory enumeration experiment

Command: `bun run benchmark:enumeration`. The smoke form, `bun run benchmark:enumeration -- --smoke`, validates fixture execution only.

Host: Apple M4 Pro, darwin 27.0.0, Bun 1.4.2. This uses the actual web Memory implementation, not native SQLite or JSI. Each run contains five batches of 30 warm samples per operation and size. Every output key/value is checked outside the timed interval.

The comparison starts from the correctness-fixed implementation, not the original release, whose arbitrary-key behavior failed the fixture. It therefore does not establish an overall speedup over the published version.

The accepted iteration change removes the repeated Map lookup in `getAll` and the intermediate prefix-key array. Two separate process runs produced these median changes versus the corrected baseline (negative is faster):

| Keys    | Operation     | Run 1  | Run 2  |
| ------- | ------------- | ------ | ------ |
| 1,000   | `getAll`      | -10.6% | -14.2% |
| 1,000   | `getByPrefix` | -8.4%  | -3.7%  |
| 10,000  | `getAll`      | -10.4% | -7.4%  |
| 10,000  | `getByPrefix` | -10.2% | -9.7%  |
| 100,000 | `getAll`      | -47.5% | -47.8% |
| 100,000 | `getByPrefix` | -12.2% | -6.9%  |

Only the 100k-key `getAll` result clearly and repeatedly exceeds the proposed 10% target: median improved about 47%, with median batch p95 improving 43–48%. Smaller results vary and do not establish repeatable gains above the target.

Peak process RSS was 318/339 MB for the corrected baseline and 400/340 MB for the candidate (decimal MB). This high-water metric was noisy and triggers review; source review found no added retained collection or cache. It does not prove equal allocation cost. Native/device performance and retained-memory profiling remain separate acceptance evidence.

An earlier ordinary-property shortcut was reverted after a 10k-key regression. An entry-tuple iteration candidate was replaced after elevated peak RSS.

Fixture SHA-256: `1ec2feb7ff55d5c61f33e4f70948336ca97d0a7746a77d9c295d7ae4417463f6`. Lockfile SHA-256: `1a6a54f48038afa313fb8a8316611f2091edf8a133bcc16173836599f1831492`. Corrected core SHA-256: `f7e8687b69d93a0fec8318877e6227b8b42ee617b68a257a17e33f83f4492b17`. Candidate core SHA-256: `e8b68c5bb3305b07eeaaff609381ec28ab564424a8fdbb53a8014f6460b6c86e`.

Raw reports and environment: `/tmp/nitro-implementation.GbjgqhYj/storage-enumeration-v2-{corrected,candidate3}{,-repeat}.json` and `storage-enumeration-environment.json` on the execution host. These temporary receipts are not portable release artifacts; the table above preserves the selected results. No device or universal speed claim is made.

### Original-release control and rejected prefix experiment

The additional `--ordinary` mode omits the special prototype key so the original 0.10.3 source and the corrected source can produce identical valid output. Two quiet process comparisons against the archived original revision measured 100k-key `getAll` median improvement of about 42%, with batch p95 improving 43–45%. This is a host web-Memory result only. The correctness-fixed `getByPrefix` was 17–20% slower at 100k keys and 15–23% slower at 1k; no overall prefix speedup is claimed.

A subsequent direct prefix scan preserved the observer path and passed independent source review, but was rejected: although 100k prefix medians improved 26–28% against the original, 1k medians regressed 66–67%. The final implementation retains the prior iteration change. The observer mutation/order regression test remains as coverage. Correctness and predictable small-workload behavior take priority over the large-workload result.

Original-control receipts: `storage-ordinary-{original,final}{,-repeat}.json` in the evidence directory above (`final` denotes retained candidate3). Rejected-experiment receipts: `storage-ordinary-candidate4{,-repeat}.json`. The ordinary-mode harness extends the fixture; its hash differs from the default-only fixture recorded above. Neither these comparisons nor peak process RSS establish native latency, retained-memory equivalence, or a universal improvement.
