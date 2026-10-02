# Getting started with the master

The master build needs a companion device checkout for narrow shared helpers
and, for tests, the actual device protocol stack. Keep the checkouts separate.
Use a C compiler and CMake; consult [testing](testing.md) for complete prerequisites.

```sh
git clone https://github.com/w1ne/iolinki.git
git -C iolinki checkout ad892f43fa7292cb3d4ccf60410f5541a0d0a5ca
git clone https://github.com/w1ne/iolinki-master.git
git -C iolinki-master checkout ee8e51e0cfa3b187a9e850c88688712832cb60f9
cd iolinki-master
cmake -S . -B build -DIOLINKI_DEVICE_DIR=../iolinki
cmake --build build --parallel 4
ctest --test-dir build --output-on-failure
```

These commands use the v1.0.0 API with the merged host-storage test linkage fix.
All 15 test targets pass with the pinned device checkout above.

Runnable examples are built by default:

- `master_loopback_demo`: one port's startup and cyclic process-data flow.
- `master_4port_controller_demo`: a mixed four-port controller with IO-Link, DI,
  DQ and deactivated modes.

Find the executables under the build's example directories. They demonstrate
simulated/fake-device behavior, not an attached commercial sensor.

## Drive the scheduler explicitly

The core owns no clock. Your application supplies monotonic time and tick
events, calls `iolink_master_process()`, and polls available receive bytes using
`iolink_master_poll_rx()`. See the [API scheduler model](api.md#2-the-tick-scheduler-model).
Check `OK`, `PENDING` and documented negative result codes.

The PHY structure is retained by pointer and must outlive the port. For a real
adapter, supply all required checked mode/baud/direction/wake hooks and run
`iolink_master_validate_phy_contract()` before operation. See
[porting](porting.md) and the [normative PHY boundary](phy-contract.md).
