# Physical-Device Keychain Lifecycle Test

Use this protocol for iOS Keychain behavior and stable error classification.
A simulator cannot prove protected-data behavior.

## Preconditions

- Use a physical iPhone or iPad with a passcode enabled.
- Build the example app from the package checkout under test.
- Do not enter a real token or credential. The probe stores a fixed non-secret
  sentinel under `WhenUnlockedThisDeviceOnly` access control.

## Lock And Resume

1. Open the example app and find **Keychain Lifecycle Probe**.
2. Press **Seed** and confirm the status changes to `seeded`.
3. Press **Arm**.
4. Lock the device, wait for the screen to turn off, then unlock it and return
   to the example app.
5. Record both probe rows without logging or inspecting the stored value.
6. Press **Wipe** after the run.

The strongest passing result is:

- Lock transition: `keychain_locked`.
- Resume transition: `readable`.

If the lock transition says `readable`, the app sampled before iOS made
protected data unavailable. Repeat the run; treat repeated readable results as
inconclusive, not as proof that locked reads work. Any resume result other than
`readable` fails the recovery contract.

## Release Evidence

Record the physical model, iOS version, package version, build configuration,
and the two displayed result codes. Do not capture or publish secure values.
