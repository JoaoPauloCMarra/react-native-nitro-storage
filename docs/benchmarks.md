# Benchmarks

Benchmarks are release checks, not product promises. Use them to catch regressions on the local machine and CI image used by this repo.

Run from the repo root:

```sh
bun run build
bun run benchmark
```

## Scope: Web Only

`benchmark` loads `lib/commonjs/index.web.js` and measures the web entry against the localStorage backend. The `disk:` and `secure:` labels describe web scopes, not native Disk or Secure storage.

Native Disk/Secure baselines require a device or simulator run and are not part of this gate. Do not compare these numbers against native storage.

## Interpreting Results

- Compare results on the same machine and Node/Bun version.
- Treat large deltas as a prompt to inspect recent storage-runtime, serialization, cache, or event changes.
- Do not compare web backend numbers against native secure storage numbers; they measure different systems.

## Release Checklist

Before publishing:

```sh
bun run codegen:check
bun run lint:check
bun run format:check
bun run typecheck
bun run test:types
bun run test
bun run test:cpp
bun run build
bun run benchmark
bun run --cwd packages/react-native-nitro-storage check:pack
```

Keep the dry-publish output in the release notes when validating a version locally.
