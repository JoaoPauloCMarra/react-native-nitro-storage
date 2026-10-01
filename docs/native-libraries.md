# Native libraries

Disk scope is a SQLite WAL key-value store. Secure scope stays on Keychain and
EncryptedSharedPreferences. Web Disk stays on the configured web backend
(IndexedDB or `localStorage`).

## Kept

| Library    | Where                                            | Why                                                                                                                                                    |
| ---------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SQLite WAL | iOS `SqliteDiskStore`, Android `DiskSqliteStore` | Transactional batch writes, literal prefix queries in SQL, and crash-safe persistence. Closest Disk engine to a dedicated mmap KV without adding MMKV. |

Existing UserDefaults suite keys and Android `NitroStorage` preferences are
copied into SQLite once, on first open. A marker in the SQLite `meta` table
(`suite_v1` on iOS, `prefs_v1` on Android) records completion, so later launches
skip the import. On iOS the suite domain is kept for downgrade safety, and Disk
key enumeration still merges its keys. On Android the legacy `NitroStorage`
preferences are kept after the import for downgrade safety, like the iOS suite;
Disk deletes remove the key from them and `clear(Disk)` clears them, so a logout
wipe leaves no pre-SQLite copy behind. Later Disk reads and writes use SQLite.

## Evaluated and not shipped

| Library           | Decision                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| MMKV              | Skipped. Disk still needs a first-party engine; MMKV remains a one-way migration source only.                                          |
| LMDB              | Rejected. Extra vendored C, mmap file-handle limits on mobile, and no system copy on Android/iOS. SQLite is already on both platforms. |
| RocksDB / LevelDB | Rejected. Heavy native footprint for small preference-sized values.                                                                    |
| yyjson            | Rejected for Disk. Typed TTL/JSON envelopes stay in JavaScript.                                                                        |

## Limits and durability

- Disk writes wait up to 5 seconds for another connection that holds the
  SQLite write lock. The library uses one connection per process, so this wait
  only happens when another process (for example an app extension in the same
  container) is writing. Reads do not wait in WAL mode. Five seconds gives the
  other writer time to finish and stays below the iOS and Android
  unresponsive-app limits.
- If the Disk database file is deleted while the app runs, the open connection
  keeps reading and writing the deleted file, and the next launch starts with
  an empty database. The library does not check for this on each call, because
  the check costs a system call on every write. Do not delete
  `nitro-storage-disk.sqlite` yourself; call
  `storage.clear(StorageScope.Disk)`.
- Each platform keeps its system SQLite checkpoint settings. iOS checkpoints
  every 1000 pages and truncates the WAL to 32 KiB; these values are set in
  code so they do not depend on the SQLite build. Android checkpoints every
  100 pages with a 512 KiB limit, applied by the Android framework to every
  pooled connection.
- Android opens the Disk database in WAL mode. If that open fails for a reason
  other than corruption (for example a full device while an older database
  converts to WAL), it opens once without WAL and uses `synchronous=FULL`, so
  reads keep working; the next launch tries WAL again. If WAL is active and the
  device is so full that the WAL shared-memory file cannot be created, reads
  fail with `storage_full` until space is free. iOS has the same limit.
- With WAL and `synchronous=NORMAL`, an app kill never loses a committed
  write. A power loss can lose the most recent commits.

## Compatibility

- Public Disk APIs (`get`/`set`/`setBatch`/`getKeysByPrefix`/`import`) are
  unchanged.
- iOS still runs the suite-domain legacy cutover before SQLite import.
- Android still uses EncryptedSharedPreferences for Secure scope.
