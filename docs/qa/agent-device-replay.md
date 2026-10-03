# Storage agent-device replay

Run these flows only against an already installed release example that matches
the source revision under test. Select the platform and exact device every time:

```sh
bun run example:replay --platform ios --udid <exact-udid>
bun run example:replay --platform android --serial <exact-serial>
```

To run selected manifest suites, pass `--flow <id>`. The runner accepts this
option more than once for distinct suite IDs:

```sh
bun run example:replay --platform ios --udid <exact-udid> --flow integrity
bun run example:replay --platform android --serial <exact-serial> --flow keychain --flow persistence-relaunch
```

Use an installed release build from the source being checked. The replay does
not start Metro, prebuild, or build an app. A development client, a different
source revision, an inferred device, or a run without the exact platform and
device selector is not release replay evidence. The task owner must separately
authorize device work after the required package implementations are ready.

Before replay, check that the example source and replay manifest match the
committed source lock. If a flow, status ID, or expected value changes, update
`e2e/storage-replay-coverage.json` and refresh that lock with the repository's
replay maintenance command. Run the checker again before the device command:

```sh
bun run example:replay:refresh
bun run example:replay:check
bun run example:replay:test
```

The runner supplies a fresh UUID as `RUN_ID` to each replay. The persistence
flow writes one `RUN_ID`-scoped Disk key, closes and relaunches the installed
app with the same ID, compares the stored value with the expected value, and
deletes that key. Other smoke and lab cases use reserved QA keys and clean only
those keys. Only the final `clear-all` suite clears whole scopes.

The `clear-all` suite (`e2e/qa-clear-all.ad`) seeds one reserved key in Memory,
Disk, and Secure, then calls `storage.clearAll()`. This wipes all example
storage in every scope on the target install, not only QA keys. It is the last
suite in the manifest, and the runner passes suites to `agent-device test` in
manifest order, so it runs after every other suite. Run it only on a disposable
example install. Use `--flow` to skip it when the install holds data you need.

The `api-extended` suite (`e2e/qa-api-extended.ad`) opens a run-on-load screen
and asserts its results through the on-screen `e2e-ext-results` label, which
joins one `;`-terminated token per check. It covers item `merge` and
`setOrDelete`, Set `toggle` and `values`, `clearGroup`, TTL `onExpired` and
`subscribeExpired`, Secure metadata and export inventory, default access
control, coalesced Secure writes, the `invalid_key` error, scoped metrics,
native Disk key events, the React hooks, and `createSecureAuthStorage` TTL. It
uses reserved `__e2e_ext_`, `__e2e_inv_`, and `__e2e_auth` keys and restores the
default access control to `WhenUnlocked` after each access-control check. Its
passcode access-control row is a gating probe for later iOS biometric work: the
flow asserts only that a `passcode-acl=` result rendered. A device without a
passcode can reject that write, and the row is not a pass for passcode-protected
storage.

Each run uses a unique session and an artifact directory under the OS temporary
directory. `agent-device test` closes each attempt session itself, including
on failure.

A replay passes only when each suite reaches its finished status and every
required status ID contains its expected public API value. A `fail=0` summary by
itself is not sufficient. Smoke and integrity rows are asserted through the
on-screen `smoke-results` and `e2e-integrity-results` labels because
agent-device `.ad` waits only see on-screen elements. The keychain suite runs one no-prompt Secure
roundtrip and keeps biometric, lock, corruption, and hardware-backed checks
explicitly pending. The smoke test's constructed `storage_full` error is read
through the public `/testing` entrypoint; it proves error-code classification
at that test adapter boundary only.

The native smoke flow requires 39 passing cases out of 41, zero failures, and
the two expected web-only skips. Update that expected summary when cases change;
do not accept a new native skip as coverage. The integrity flow also checks that
a Promise-returning transaction rolls back and closes its context on Memory,
Disk, and Secure.

Native replay rows identify the public runtime platform and backend capability,
then assert values returned through the default package entrypoint. This
supports installed-app Disk and Secure behavior claims for that target. It does
not prove hardware-backed keys, biometrics, locked-device behavior, corruption
recovery, or a native Disk/Secure write failure. Those checks need controlled
native or hardware prerequisites and remain pending in the coverage manifest.
Unit tests for an injected adapter boundary are useful logic evidence, but they
do not close a native-runtime prerequisite.
