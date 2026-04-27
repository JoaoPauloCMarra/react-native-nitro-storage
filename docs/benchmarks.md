# Benchmarks

Benchmarks are release checks, not product promises. Use them to catch regressions on the local machine and CI image used by this repo.

Run:

```sh
bun run benchmark -- --filter=react-native-nitro-storage
```

The benchmark script checks representative synchronous read/write paths and fails when results drift beyond the configured threshold.

## Interpreting Results

- Compare results on the same machine and Node/Bun version.
- Treat large deltas as a prompt to inspect recent storage-runtime, serialization, native bridge, or cache changes.
- Do not compare web backend numbers against native secure storage numbers; they measure different systems.
- Secure storage performance depends on platform state, device lock state, biometric prompts, and Keystore/Keychain behavior.

## Release Checklist

Before publishing:

```sh
bun run lint -- --filter=react-native-nitro-storage
bun run format:check -- --filter=react-native-nitro-storage
bun run typecheck -- --filter=react-native-nitro-storage
bun run test:types -- --filter=react-native-nitro-storage
bun run test -- --filter=react-native-nitro-storage
bun run test:cpp -- --filter=react-native-nitro-storage
bun run build -- --filter=react-native-nitro-storage
bun run benchmark -- --filter=react-native-nitro-storage
(cd packages/react-native-nitro-storage && bun run check:pack)
npm publish --dry-run
```

Keep the dry-publish output in the release notes when validating a version locally.
