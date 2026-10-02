# Getting started with the device

Run these commands from the source checkout. Debian/Ubuntu prerequisites are
`git`, `cmake`, `build-essential` and `libcmocka-dev`.

```sh
git clone https://github.com/w1ne/iolinki.git
cd iolinki
git checkout ad892f43fa7292cb3d4ccf60410f5541a0d0a5ca
cmake -S . -B build -DIOLINK_PLATFORM=LINUX -DCMAKE_BUILD_TYPE=Debug
cmake --build build --parallel 4
ctest --test-dir build --output-on-failure
./build/examples/reference_device/reference_device_demo
```

The demo asserts 100 exchanges: framing, checksum, counter input and alternating
LED output. A successful run ends with `SIMULATION PASS`. It uses a virtual PHY
and relaxes physical timing enforcement for host execution. Keep hardware timing
enforcement enabled when moving to a board.

## The three input bytes and one output byte

| Direction | Map |
| --- | --- |
| Device → master | Bytes 0–1: big-endian 16-bit counter; byte 2: button state |
| Master → device | Byte 0 bit 0: LED command |

`reference_device_tick()` runs at the application's sampling cadence.
`iolink_device_process()` runs much more frequently; a millisecond delay in the
communication path does not establish the required response timing.

The example identity is experimental, not a vendor/device assignment for your
product. See the [complete counter guide](examples/counter.md),
[current API](api.md) and [IODD tools](iodd.md).

## Select a board integration

- [STM32G0B1RE + TIOL112](examples/stm32g0.md): bare metal, complete GCC build,
  native IAR project and hardware-backed timestamp.
- [ESP32-C3 + L6362A](examples/esp32-c3.md): ESP-IDF/PlatformIO firmware and
  IRQ-buffered UART adapter.
- [STM32U5 + TIOL112](examples/stm32u5.md): Zephyr integration for the named
  Nucleo reference.

Read the source-linked guides for dependencies and pin assignments. Compilation
and [released simulation](simulation.md) are separate from measured physical
transceiver/master behavior.
