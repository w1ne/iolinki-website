# iolinki documentation

Build an IO-Link device or integrate the companion master stack. These guides
publish the source documentation as readable, searchable pages, using the same
MkDocs Material approach as LabWired.

| Product | Start here | Reference | Validation |
| --- | --- | --- | --- |
| **Device v2.1.0** | [Run the reference device](device/v2.1.0/getting-started.md) | [Device API](device/v2.1.0/api.md), [porting](device/v2.1.0/porting.md) | [Released firmware simulation](device/v2.1.0/simulation.md) |
| **Master v1.0.0** | [Build the master demos](master/v1.0.0/getting-started.md) | [Master API](master/v1.0.0/api.md), [PHY contract](master/v1.0.0/phy-contract.md) | [Software tests](master/v1.0.0/testing.md), [hardware matrix](master/v1.0.0/hardware-validation.md) |

## Choose a starting point

- **Evaluate on a computer:** run the [counter/button/LED device](device/v2.1.0/examples/counter.md).
- **Build MCU firmware:** use [STM32G0/TIOL112 and native IAR](device/v2.1.0/examples/stm32g0.md),
  [ESP32-C3/L6362A](device/v2.1.0/examples/esp32-c3.md), or
  [STM32U5/Zephyr](device/v2.1.0/examples/stm32u5.md).
- **Describe a sensor:** start with the [switching sensor](device/v2.1.0/examples/switching-sensor.md)
  and [IODD command-line tools](device/v2.1.0/iodd.md).
- **Connect the master to a board:** implement the [master PHY contract](master/v1.0.0/phy-contract.md)
  and complete the [physical validation matrix](master/v1.0.0/hardware-validation.md).

## Read the evidence at its actual level

Host assertions prove software behavior. A target build proves compilation and
linking. The released G0 and C3 recipes execute MCU firmware in LabWired, with
the engine pins and assertions listed on the [simulation page](device/v2.1.0/simulation.md).
None of those results is physical-master interoperability or official certification.
Native IAR source projects are provided; an IAR build was not run for the release.

Technical documentation is pinned to device `ad892f43fa72` and master
`d23fd3034c02`. Follow each page's source snapshot link for its immutable original.
[Licensing and publication sources](licensing.md) distinguish release snapshots
from current commercial offers. Return to [iolinki.com](https://iolinki.com/)
for product and evaluation information.
