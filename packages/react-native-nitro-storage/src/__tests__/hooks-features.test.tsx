import { act, renderHook } from "@testing-library/react-hooks";
import {
  createNitroStorageMock,
  useStorage,
  useStorageActions,
  useStorageValue,
} from "../testing";

describe("useStorage actions", () => {
  it("returns [value, setter, actions] with a stable actions object", () => {
    const { memoryItem } = createNitroStorageMock();
    const item = memoryItem<{ n: number }>({
      key: "o",
      defaultValue: { n: 0 },
    });
    const { result } = renderHook(() => useStorage(item));

    expect(result.current[0]).toEqual({ n: 0 });
    const firstActions = result.current[2];

    act(() => result.current[1]({ n: 1 }));
    expect(result.current[0]).toEqual({ n: 1 });
    expect(result.current[2]).toBe(firstActions);

    act(() => result.current[2].merge({ n: 5 }));
    expect(result.current[0]).toEqual({ n: 5 });

    act(() => result.current[2].reset());
    expect(result.current[0]).toEqual({ n: 0 });
  });

  it("useStorageActions exposes remove/setOrDelete", () => {
    const { diskItem } = createNitroStorageMock();
    const item = diskItem<string | null>({ key: "t", defaultValue: null });
    const { result } = renderHook(() => useStorageActions(item));

    act(() => result.current.setOrDelete("v"));
    expect(item.get()).toBe("v");
    act(() => result.current.remove());
    expect(item.has()).toBe(false);
  });
});

describe("useStorageValue", () => {
  it("returns a read-only reactive value", () => {
    const { memoryItem } = createNitroStorageMock();
    const item = memoryItem<number>({ key: "c", defaultValue: 0 });
    const { result } = renderHook(() => useStorageValue(item));

    expect(result.current).toBe(0);
    act(() => item.set(3));
    expect(result.current).toBe(3);
  });

  it("does not re-render when an unrelated item changes", () => {
    const { memoryItem } = createNitroStorageMock();
    const a = memoryItem<number>({ key: "a", defaultValue: 0 });
    const b = memoryItem<number>({ key: "b", defaultValue: 0 });

    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useStorageValue(a);
    });

    const baseline = renders;
    act(() => b.set(1));
    expect(renders).toBe(baseline);

    act(() => a.set(1));
    expect(renders).toBe(baseline + 1);
  });
});
