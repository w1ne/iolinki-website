# Master stack v1.0.0

`iolinki-master` is a separate C protocol-core package. It uses caller-owned opaque
port/controller storage and a board PHY adapter. It does not link the full device
stack into a production master; only narrow shared CRC/frame/PHY helpers are used.

Technical pages in this section are a snapshot of
[`d23fd3034c0203ef829bd9734806389f8708fa94`](https://github.com/w1ne/iolinki-master/tree/d23fd3034c0203ef829bd9734806389f8708fa94)
for the v1.0.0 documentation bundle. For the exact release artifacts and their
embedded source manifest, use the
[v1.0.0 release](https://github.com/w1ne/iolinki-master/releases/tag/v1.0.0).
This documentation snapshot and a release artifact's source pin are identified
separately; do not infer that every later documentation commit is in an archive.

## Start with a simulated port

- [Build the loopback and four-port demos](getting-started.md).
- Use the [API guide](api.md) for configuration, scheduling, process data, ISDU,
  diagnosis and controller fan-out.
- Implement the [porting guide](porting.md) and [PHY contract](phy-contract.md)
  before connecting a board.
- Check the [implementation ledger](implementation-status.md),
  [software tests](testing.md) and [hardware matrix](hardware-validation.md).

The master is simulation-validated protocol-core software. Real transceiver
wake-pulse timing, real-device interoperability and official conformance are not
established by host or simulated firmware results. Its commercial license is a
separate product from the device license; see [licensing](../../licensing.md).
