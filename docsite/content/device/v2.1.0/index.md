# Device stack v2.1.0

`iolinki` is the C IO-Link device protocol stack. The shared application publishes
a counter and button state and consumes one LED output byte. Target adapters
supply UART, GPIO, clock, critical sections and persistence behind a PHY contract.

This section publishes documentation from
[`ad892f43fa7292cb3d4ccf60410f5541a0d0a5ca`](https://github.com/w1ne/iolinki/tree/ad892f43fa7292cb3d4ccf60410f5541a0d0a5ca),
the pinned device v2.1.0 release source. Download the
[v2.1.0 release artifacts](https://github.com/w1ne/iolinki/releases/tag/v2.1.0)
or build the same source yourself.

## Run, port, then verify

1. [Build and run on the host](getting-started.md). The executable checks 100
   exchanges and reports `SIMULATION PASS` only after its assertions succeed.
2. Read the [current device API](api.md) and [porting checklist](porting.md).
3. Choose the [STM32G0](examples/stm32g0.md), [ESP32-C3](examples/esp32-c3.md),
   or [STM32U5](examples/stm32u5.md) reference integration.
4. Generate and validate your [IODD](iodd.md), replacing experimental identity
   values and matching your actual process-data/parameter map.
5. Separate [firmware simulation](simulation.md) from
   [physical validation](physical-validation.md) and [conformance](conformance.md).

The release also includes a [switching sensor](examples/switching-sensor.md) with
threshold, hysteresis, inversion and teach behavior. Its parameters are volatile.
Persistence needs a real backend; the STM32G0 reference deliberately reports
unsupported NVM rather than acknowledging a stored value it cannot retain.
