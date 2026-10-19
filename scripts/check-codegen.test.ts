import { expect, test } from "bun:test";
import { snapshotGeneratedFiles } from "./check-codegen";

test("the generated snapshot includes tracked dotfiles", async () => {
  const snapshot = await snapshotGeneratedFiles();
  expect(snapshot.has(".gitattributes")).toBe(true);
});
