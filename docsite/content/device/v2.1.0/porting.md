# Porting the device stack

Start with the [current context API](api.md), the [portable TIOL112 driver](tiol112.md)
and a complete named target example. The release repository's older `PORTING.md`
contains conceptual snippets that predate the callback signatures; use the
target source as your implementation reference.

## Implement the hardware boundary

1. Configure UART for **eight data bits, even parity, one stop bit** at the
   selected COM1/COM2/COM3 rate: 4800/38400/230400 baud. On STM32, the word-length
   register includes parity; eight payload bits require a nine-bit word.
2. Buffer receive bytes in the UART ISR. Return overflow, parity and framing
   failures as transport errors; do not pass damaged bytes as valid data.
3. Drive EN only while transmitting or deliberately driving SIO. Wait for the
   final stop bit, use a bounded timeout and release EN on every exit. Suppress
   local echo without losing the following master frame.
4. Latch WAKE in an interrupt and consume it atomically. Keep NFAULT separate;
   it is an aggregate transceiver fault indicator, not a wake event or proof of
   a specific short circuit.
5. Supply a hardware-backed monotonic microsecond timer. Existing DLL/global
   timing calls still use `iolink_time_get_us()`; a config callback alone does
   not replace the complete platform timing surface.
6. Supply nested critical-section hooks that restore prior interrupt state.
   Advertise persistence only with a functioning NVM backend that checks errors.

## Integrate the source list

The native [STM32G0 project](examples/stm32g0.md) lists the core sources and gives
complete GCC and IAR integration. Exclude Linux/virtual PHY, approximate bare-metal
time implementations and weak stubs from a real target. When providing strong
platform hooks, exclude `platform.c` too rather than relying on compiler-specific
weak symbols.

Keep application, identity, configuration, PHY driver and callback-user storage
alive throughout operation. Sample process data on an application cadence while
servicing the protocol loop frequently. Replace example manufacturer/device IDs,
hardware revision and serial identity for the real product.

## Select the target guide

| Target | Integration |
| --- | --- |
| [STM32G0B1RE + TIOL112](examples/stm32g0.md) | Bare metal, register adapter, IRQ receive, TIM2 clock, native IAR source project |
| [ESP32-C3 + L6362A](examples/esp32-c3.md) | ESP-IDF adapter and external transceiver wiring |
| [STM32U5 + TIOL112](examples/stm32u5.md) | Zephyr UART/GPIO integration |

Use the guide's exact pin map and board schematic. The 24V C/Q field interface
must go through the transceiver; it is not an MCU UART pin.

## Establish evidence in order

First build and run host assertions. Then cross-build the complete target image.
Use [released simulator recipes](simulation.md) for their listed MCU execution
checks. Finally measure startup, interrupt-to-response timing, line direction,
ISDU, events, fallback, advertised speeds and disconnect recovery with an actual
master. See [physical validation](physical-validation.md). Simulator success does
not supply transceiver analog behavior or official conformance approval.
