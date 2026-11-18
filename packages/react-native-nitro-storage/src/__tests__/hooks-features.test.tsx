import { act, renderHook } from "@testing-library/react-native";
import {
  createNitroStorageMock,
  useStorage,
  useStorageActions,
  useStorageValue,
} from "../testing";

describe("useStorage actions", () => {
  it("returns [value, setter, actions] with a stable actions object", async () => {
    const { memoryItem } = createNitroStorageMock();
    const item = memoryItem<{ n: number }>({
      key: "o",
      defaultValue: { n: 0 },
    });
    const { result } = await renderHook(() => useStorage(item));

    expect(result.current[0]).toEqual({ n: 0 });
    const firstActions = result.current[2];

    await act(() => result.current[1]({ n: 1 }));
    expect(result.current[0]).toEqual({ n: 1 });
    expect(result.current[2]).toBe(firstActions);

    await act(() => result.current[2].merge({ n: 5 }));
    expect(result.current[0]).toEqual({ n: 5 });

    await act(() => result.current[2].reset());
    expect(result.current[0]).toEqual({ n: 0 });
  });

  it("useStorageActions exposes remove/setOrDelete", async () => {
    const { diskItem } = createNitroStorageMock();
    const item = diskItem<string | null>({ key: "t", defaultValue: null });
    const { result } = await renderHook(() => useStorageActions(item));

    await act(() => result.current.setOrDelete("v"));
    expect(item.get()).toBe("v");
    await act(() => result.current.remove());
    expect(item.has()).toBe(false);
  });
});

describe("useStorageValue", () => {
  it("returns a read-only reactive value", async () => {
    const { memoryItem } = createNitroStorageMock();
    const item = memoryItem<number>({ key: "c", defaultValue: 0 });
    const { result } = await renderHook(() => useStorageValue(item));

    expect(result.current).toBe(0);
    await act(() => item.set(3));
    expect(result.current).toBe(3);
  });

  it("does not re-render when an unrelated item changes", async () => {
    const { memoryItem } = createNitroStorageMock();
    const a = memoryItem<number>({ key: "a", defaultValue: 0 });
    const b = memoryItem<number>({ key: "b", defaultValue: 0 });

    let renders = 0;
    await renderHook(() => {
      renders += 1;
      return useStorageValue(a);
    });

    const baseline = renders;
    await act(() => b.set(1));
    expect(renders).toBe(baseline);

    await act(() => a.set(1));
    expect(renders).toBe(baseline + 1);
  });
});
