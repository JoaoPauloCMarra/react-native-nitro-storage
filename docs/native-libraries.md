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
preferences are cleared once the import marker commits, so `clear(Disk)` leaves
no pre-SQLite copy behind. Later Disk reads and writes use SQLite.

## Evaluated and not shipped

| Library           | Decision                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| MMKV              | Skipped. Disk still needs a first-party engine; MMKV remains a one-way migration source only.                                          |
| LMDB              | Rejected. Extra vendored C, mmap file-handle limits on mobile, and no system copy on Android/iOS. SQLite is already on both platforms. |
| RocksDB / LevelDB | Rejected. Heavy native footprint for small preference-sized values.                                                                    |
| yyjson            | Rejected for Disk. Typed TTL/JSON envelopes stay in JavaScript.                                                                        |

## Compatibility

- Public Disk APIs (`get`/`set`/`setBatch`/`getKeysByPrefix`/`import`) are
  unchanged.
- iOS still runs the suite-domain legacy cutover before SQLite import.
- Android still uses EncryptedSharedPreferences for Secure scope.
