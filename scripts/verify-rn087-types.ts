import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Glob } from "bun";

type JsonRecord = Record<string, unknown>;
type DependencyMap = Record<string, string>;

const projectRoot = import.meta.dir + "/..";

function asRecord(value: unknown): JsonRecord {
  return value != null && typeof value === "object"
    ? (value as JsonRecord)
    : {};
}

function asDependencies(value: unknown): DependencyMap {
  const entries = Object.entries(asRecord(value)).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return Object.fromEntries(entries);
}

function run(
  command: string[],
  cwd: string,
): { exitCode: number; output: string } {
  const result = Bun.spawnSync(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const decoder = new TextDecoder();
  return {
    exitCode: result.exitCode,
    output: `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`,
  };
}

async function main(): Promise<void> {
  const packageFiles = Array.from(
    new Glob("packages/*/package.json").scanSync({ cwd: projectRoot }),
  );
  if (packageFiles.length !== 1) {
    throw new Error(
      `Expected one package manifest, found ${packageFiles.length}.`,
    );
  }

  const packageManifestPath = join(projectRoot, packageFiles[0]);
  const packageManifest = JSON.parse(
    await Bun.file(packageManifestPath).text(),
  ) as JsonRecord;
  const packageName = String(packageManifest.name);
  const packageRoot = dirname(packageManifestPath);
  const sourceDirectory = join(packageRoot, "src");
  const sourceEntry = join(sourceDirectory, "index.ts");
  const temporaryRoot = await mkdtemp(join(tmpdir(), "nitro-rn087-types-"));

  try {
    const build = run(["bun", "run", "build"], projectRoot);
    if (build.exitCode !== 0) {
      throw new Error(
        `Package declaration build failed before the RN 0.87 consumer check:\n${build.output}`,
      );
    }

    const declarationEntry = join(
      packageRoot,
      "lib/typescript/index.d.ts",
    );
    if (!(await Bun.file(declarationEntry).exists())) {
      throw new Error(`Missing emitted declaration file: ${declarationEntry}`);
    }

    const pack = run(
      [
        "bun",
        "pm",
        "pack",
        "--ignore-scripts",
        "--destination",
        temporaryRoot,
      ],
      packageRoot,
    );
    if (pack.exitCode !== 0) {
      throw new Error(
        `Package declaration artifact failed to pack:\n${pack.output}`,
      );
    }

    const tarballs = Array.from(
      new Glob("*.tgz").scanSync({ cwd: temporaryRoot }),
    );
    if (tarballs.length !== 1) {
      throw new Error(
        `Expected one packed package artifact, found ${tarballs.length}.\n${pack.output}`,
      );
    }
    const packageTarball = join(temporaryRoot, tarballs[0]);
    const consumerEntry = join(temporaryRoot, "consumer.ts");
    const reactNativeShim = join(temporaryRoot, "react-native-shim.d.ts");

    await Bun.write(
      reactNativeShim,
      `import type { ComponentType } from "react";

declare module "react-native" {
  export const Platform: { OS: string };
  export type HostComponent<P> = ComponentType<P>;
  export type ViewProps = Record<string, unknown>;
}
`,
    );
    await Bun.write(
      consumerEntry,
      `import {
  AccessControl,
  BiometricLevel,
  StorageScope,
  createSecureAuthStorage,
  createSetItem,
  createStorageItem,
  getBatch,
  migrateFromMMKV,
  secureItem,
  setBatch,
  storage,
  useSetStorage,
  useStorage,
  useStorageActions,
  useStorageSelector,
  useStorageValue,
} from "${packageName}";
import { createIndexedDBBackend as createIndexedDBBackendFromSubpath } from "${packageName}/indexeddb-backend";
import {
  createNitroStorageMock,
  resetNitroStorageMock,
} from "${packageName}/testing";
import type { IndexedDBBackendOptions } from "${packageName}/indexeddb-backend";
import type {
  SetStorageItem,
  StorageActions,
  StorageItem,
  StorageSetter,
} from "${packageName}";

const countItem = createStorageItem({
  key: "count",
  scope: StorageScope.Memory,
  defaultValue: 0,
});
const [count, setCount, countActions] = useStorage(countItem);
const countSetter: StorageSetter<number> = useSetStorage(countItem);
const countActionsTyped: StorageActions<number> = useStorageActions(countItem);
const [positive] = useStorageSelector(countItem, (value) => value > 0);
const countReadOnly: number = useStorageValue(countItem);
setCount(count + 1);
countSetter(2);
countActions.set(3);
countActionsTyped.reset();

const auth = createSecureAuthStorage({
  accessToken: { biometric: true, accessControl: AccessControl.AfterFirstUnlock },
  refreshToken: {},
});
auth.accessToken.set("token");
const token: string = auth.accessToken.get();
const secret = secureItem<string>({ key: "secret", defaultValue: "" });
secret.set("value");

const colors = createSetItem<"red" | "blue">({
  key: "colors",
  scope: StorageScope.Disk,
  defaultValue: ["red"],
});
const membership: Partial<Record<"red" | "blue", true>> = colors.get();
colors.add("blue");
// @ts-expect-error a set member may be absent from the returned map
const definitelyRed: true = membership.red;
// @ts-expect-error unknown members must be rejected by the typed set
colors.add("green");

const typedBatch = getBatch([countItem] as const, StorageScope.Memory);
const batchCount: number = typedBatch[0];
setBatch([{ item: countItem, value: 4 }], StorageScope.Memory);
// @ts-expect-error batch values must match the item value type
setBatch([{ item: countItem, value: "four" }], StorageScope.Memory);

const migratedItem = createStorageItem({
  key: "legacy-count",
  scope: StorageScope.Disk,
  defaultValue: 0,
});
const migrated = migrateFromMMKV(
  {
    getString: () => undefined,
    getNumber: () => 4,
    getBoolean: () => undefined,
    contains: () => true,
    delete: () => {},
    getAllKeys: () => ["legacy-count"],
  },
  migratedItem,
);
const migratedItemContract: StorageItem<number> = migratedItem;

const indexedDbOptions: IndexedDBBackendOptions = {
  channelName: "typed-consumer",
  onError: (error) => void error,
};
const indexedDbBackend = createIndexedDBBackendFromSubpath(
  "typed-db",
  "keyvalue",
  indexedDbOptions,
);
const mock = createNitroStorageMock();
const mockItem = mock.memoryItem({ key: "mock", defaultValue: "" });
mockItem.set("value");
resetNitroStorageMock();
storage.getCapabilities();
const biometricLevel: BiometricLevel = BiometricLevel.BiometryOnly;
const setSurface: SetStorageItem<"red" | "blue"> = colors;
void positive;
void countReadOnly;
void countActions;
void batchCount;
void token;
void migrated;
void migratedItemContract;
void indexedDbBackend;
void biometricLevel;
void setSurface;
`,
    );

    const dependencies: DependencyMap = {
      ...asDependencies(packageManifest.dependencies),
      ...asDependencies(packageManifest.peerDependencies),
      ...asDependencies(packageManifest.devDependencies),
      "@types/node": "^24.0.0",
      "@types/react": "~19.2.18",
      react: "19.2.3",
      "react-native": "0.87.0",
      "react-native-nitro-modules": "0.37.0",
      typescript: "6.0.3",
      [packageName]: `file:${packageTarball}`,
    };

    await Bun.write(
      join(temporaryRoot, "package.json"),
      JSON.stringify(
        {
          name: `${packageName}-rn087-typecheck`,
          private: true,
          dependencies,
        },
        null,
        2,
      ),
    );
    await Bun.write(
      join(temporaryRoot, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            allowSyntheticDefaultImports: true,
            baseUrl: temporaryRoot,
            esModuleInterop: true,
            ignoreDeprecations: "6.0",
            lib: ["ES2020", "DOM"],
            module: "ESNext",
            moduleResolution: "bundler",
            noEmit: true,
            noFallthroughCasesInSwitch: true,
            noImplicitReturns: true,
            noImplicitOverride: true,
            noUncheckedIndexedAccess: true,
            paths: {
              react: [
                join(temporaryRoot, "node_modules/@types/react/index.d.ts"),
              ],
              "react/*": [join(temporaryRoot, "node_modules/@types/react/*")],
              "react-native": [reactNativeShim],
            },
            skipLibCheck: false,
            strict: true,
            target: "ES2020",
            types: ["react"],
          },
          include: ["consumer.ts"],
        },
        null,
        2,
      ),
    );

    const install = run(
      ["bun", "install", "--ignore-scripts", "--no-progress"],
      temporaryRoot,
    );
    if (install.exitCode !== 0) {
      throw new Error(
        `RN 0.87 compatibility dependencies failed to install:\n${install.output}`,
      );
    }

    const typecheck = run(
      ["bun", "x", "tsc", "--noEmit", "-p", "tsconfig.json"],
      temporaryRoot,
    );
    if (typecheck.exitCode !== 0) {
      throw new Error(
        `Packed declaration consumer compatibility failed:\n${typecheck.output}`,
      );
    }

    await Bun.write(
      join(temporaryRoot, "tsconfig.rn087.json"),
      JSON.stringify(
        {
          compilerOptions: {
            allowSyntheticDefaultImports: true,
            baseUrl: temporaryRoot,
            esModuleInterop: true,
            ignoreDeprecations: "6.0",
            jsx: "react-native",
            module: "ESNext",
            moduleResolution: "bundler",
            noEmit: true,
            noFallthroughCasesInSwitch: true,
            noImplicitReturns: true,
            noImplicitOverride: true,
            noUncheckedIndexedAccess: true,
            paths: {
              [packageName]: [sourceEntry],
              [`${packageName}/*`]: [`${sourceDirectory}/*`],
              react: [
                join(temporaryRoot, "node_modules/@types/react/index.d.ts"),
              ],
              "react/*": [join(temporaryRoot, "node_modules/@types/react/*")],
              "react-native": [
                join(
                  temporaryRoot,
                  "node_modules/react-native/types_generated/index.d.ts",
                ),
              ],
              "react-native/*": [
                join(temporaryRoot, "node_modules/react-native/*"),
              ],
            },
            skipLibCheck: true,
            strict: true,
            target: "ES2020",
            types: ["node", "react", "react-native"],
          },
          include: [sourceEntry, `${sourceDirectory}/**/*.d.ts`],
        },
        null,
        2,
      ),
    );

    const sourceTypecheck = run(
      ["bun", "x", "tsc", "--noEmit", "-p", "tsconfig.rn087.json"],
      temporaryRoot,
    );
    if (sourceTypecheck.exitCode !== 0) {
      throw new Error(
        `RN 0.87 source compatibility failed:\n${sourceTypecheck.output}`,
      );
    }

    console.log(
      `${packageName} passes the packed declaration and RN 0.87 TypeScript compatibility checks.`,
    );
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

await main();
