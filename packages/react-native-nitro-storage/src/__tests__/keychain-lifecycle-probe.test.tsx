import { act, fireEvent, render } from "@testing-library/react-native";
import { createElement } from "react";
import { AppState, type AppStateStatus } from "react-native";

jest.mock(
  "react-native-nitro-storage",
  () => {
    const probeItem = {
      delete: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
    };
    return {
      __probeItem: probeItem,
      AccessControl: { WhenUnlockedThisDeviceOnly: 3 },
      StorageScope: { Secure: 2 },
      createStorageItem: jest.fn(() => probeItem),
      getStorageErrorCode: jest.fn((error: unknown) =>
        error instanceof Error
          ? error.message.match(/\[nitro-error:([a-z_]+)\]/)?.[1]
          : undefined,
      ),
      isStorageError: jest.fn(
        (error: unknown, code: string) =>
          error instanceof Error &&
          error.message.includes(`[nitro-error:${code}]`),
      ),
    };
  },
  { virtual: true },
);

import { KeychainLifecycleProbe } from "../../../../apps/example/components/keychain-lifecycle-probe";

const { __probeItem: probeItem } = jest.requireMock(
  "react-native-nitro-storage",
) as {
  __probeItem: {
    delete: jest.Mock;
    get: jest.Mock;
    set: jest.Mock;
  };
};

describe("KeychainLifecycleProbe", () => {
  let appStateListener: ((state: AppStateStatus) => void) | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    appStateListener = undefined;
    jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation((_type, listener) => {
        appStateListener = listener;
        return { remove: jest.fn() };
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("records a locked background read and a successful foreground recovery", () => {
    const screen = render(createElement(KeychainLifecycleProbe));

    fireEvent.press(screen.getByTestId("keychain-probe-seed"));
    expect(probeItem.set).toHaveBeenCalledWith("lifecycle-probe-sentinel");

    fireEvent.press(screen.getByTestId("keychain-probe-arm"));
    probeItem.get.mockImplementationOnce(() => {
      throw new Error(
        "[nitro-error:keychain_locked] NitroStorage: Keychain is locked",
      );
    });
    act(() => appStateListener?.("background"));
    expect(screen.getByTestId("keychain-probe-background")).toHaveTextContent(
      "keychain_locked",
    );

    probeItem.get.mockReturnValueOnce("lifecycle-probe-sentinel");
    act(() => appStateListener?.("active"));
    expect(screen.getByTestId("keychain-probe-foreground")).toHaveTextContent(
      "readable",
    );
  });
});
