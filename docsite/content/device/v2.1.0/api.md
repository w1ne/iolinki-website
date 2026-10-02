# Device application API

Use the context-based API in
[`include/iolinki/device.h`](https://github.com/w1ne/iolinki/blob/ad892f43fa7292cb3d4ccf60410f5541a0d0a5ca/include/iolinki/device.h)
for a new application. Allocate caller-owned storage and access runtime state
through the public functions. Configuration and referenced identity/callback
storage must remain alive for the device lifetime.

## Initialization and protocol loop

```c
#include "iolinki/device.h"

static iolink_device_ctx_t device;
static iolink_device_config_t config;

int initialize_device(const iolink_phy_api_t *phy,
                      const iolink_device_info_t *identity)
{
    config.phy = *phy;
    config.device_info = identity;
    config.stack.m_seq_type = IOLINK_M_SEQ_TYPE_2_V;
    config.stack.pd_in_len = 3;
    config.stack.pd_out_len = 1;
    config.stack.min_cycle_time = 10;
    return iolink_device_init(&device, &config);
}

void service_protocol(void)
{
    iolink_device_process(&device);
}
```

Provide a real initialized PHY and timing hooks before entering the loop. The
[complete shared application](examples/counter.md) and
[its source](https://github.com/w1ne/iolinki/blob/ad892f43fa7292cb3d4ccf60410f5541a0d0a5ca/examples/reference_device/reference_device.c)
show process-data, notification and storage lifetime together.

## Core calls

| Function | Purpose and result |
| --- | --- |
| `iolink_device_init(ctx, config)` | Bind persistent configuration and initialize layers; 0 on success, negative on failure |
| `iolink_device_process(ctx)` | Service protocol/timing; call frequently without sleeping in the response path |
| `iolink_device_pd_input_update(ctx, data, len, valid)` | Publish device input; 0 on success, negative on failure |
| `iolink_device_pd_output_read(ctx, data, len)` | Copy latest master output; 0 on success, negative on failure |
| `iolink_device_get_events_ctx(ctx)` | Obtain the event context for `iolink_event_trigger()` |
| `iolink_device_get_ds_ctx(ctx)` | Obtain the data-storage context |
| `iolink_device_get_dll_stats(ctx, out)` | Copy DLL diagnostics |

Check return values against the pinned header. The release's output-read contract
uses **0 for success**, not a returned byte count.

## PHY and platform interfaces

The current
[`iolink_phy_api_t`](https://github.com/w1ne/iolinki/blob/ad892f43fa7292cb3d4ccf60410f5541a0d0a5ca/include/iolinki/phy.h)
contains `void *user`; every callback receives it. `send` returns the exact number
of transmitted bytes or a negative failure. `recv_byte` returns 1 for one byte,
0 for no data, and a negative transport error.

[`iolink_tiol112_io_t`](https://github.com/w1ne/iolinki/blob/ad892f43fa7292cb3d4ccf60410f5541a0d0a5ca/include/iolinki/phy_tiol112.h)
provides MCU callbacks to the portable TIOL112 driver. Read the
[TIOL112 integration guide](tiol112.md) for UART, EN, WAKE and NFAULT semantics.
[`platform.h`](https://github.com/w1ne/iolinki/blob/ad892f43fa7292cb3d4ccf60410f5541a0d0a5ca/include/iolinki/platform.h)
and [`time_utils.h`](https://github.com/w1ne/iolinki/blob/ad892f43fa7292cb3d4ccf60410f5541a0d0a5ca/include/iolinki/time_utils.h)
define critical-section, NVM and monotonic clock hooks.

## Public reference headers

- [Device configuration and lifecycle](https://github.com/w1ne/iolinki/blob/ad892f43fa7292cb3d4ccf60410f5541a0d0a5ca/include/iolinki/device.h)
- [PHY transport](https://github.com/w1ne/iolinki/blob/ad892f43fa7292cb3d4ccf60410f5541a0d0a5ca/include/iolinki/phy.h)
- [Parameters](https://github.com/w1ne/iolinki/blob/ad892f43fa7292cb3d4ccf60410f5541a0d0a5ca/include/iolinki/params.h)
- [Events](https://github.com/w1ne/iolinki/blob/ad892f43fa7292cb3d4ccf60410f5541a0d0a5ca/include/iolinki/events.h)
- [ISDU and vendor services](https://github.com/w1ne/iolinki/blob/ad892f43fa7292cb3d4ccf60410f5541a0d0a5ca/include/iolinki/isdu.h)
- [Data storage](https://github.com/w1ne/iolinki/blob/ad892f43fa7292cb3d4ccf60410f5541a0d0a5ca/include/iolinki/data_storage.h)

The older repository `docs/API.md` includes legacy singleton and obsolete PHY
examples. This page intentionally documents the pinned public context interface
instead of presenting those snippets as a current hardware recipe.
