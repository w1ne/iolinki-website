/* SPDX-License-Identifier: GPL-3.0-or-later
 * Application-level MCU witness. This does not exercise an IO-Link PHY. */
#include "switching_sensor.h"
#include "iodd-mapping.h"
#include "iodd-defaults.h"
#ifdef IODD_HOST_PROOF
#include <stdio.h>
#endif
_Static_assert(IODD_V_SP1_INDEX == 256u && IODD_V_HYSTERESIS_INDEX == 257u &&
               IODD_V_INVERSION_INDEX == 258u && IODD_V_TEACH_INDEX == 259u,
               "IODD parameter mapping differs from released sensor");
_Static_assert(IODD_PD_IN_BYTES == 3u && IODD_PD_IN_BITS == 24u &&
               IODD_PD_IN_FIELD_1_OFFSET == 8u && IODD_PD_IN_FIELD_1_BITS == 16u &&
               IODD_PD_IN_FIELD_2_OFFSET == 1u && IODD_PD_IN_FIELD_2_BITS == 1u &&
               IODD_PD_IN_FIELD_3_OFFSET == 0u && IODD_PD_IN_FIELD_3_BITS == 1u,
               "IODD process mapping differs from released sensor");
#ifndef IODD_HOST_PROOF
#define REG32(address) (*(volatile uint32_t *)(address))
static void console_init(void) {
    /* STM32F401 USART2 TX on PA2/AF7; no HAL or transceiver dependency. */
    REG32(0x40023830u) |= 1u;
    REG32(0x40023840u) |= 1u << 17;
    REG32(0x40020000u) = (REG32(0x40020000u) & ~(3u << 4)) | (2u << 4);
    REG32(0x40020020u) = (REG32(0x40020020u) & ~(15u << 8)) | (7u << 8);
    /* Startup uses HSI: 16 MHz / 115200, rounded to 139. */
    REG32(0x40004408u) = 139u;
    REG32(0x4000440cu) = (1u << 13) | (1u << 3);
}
#endif
static void emit(const char *text) {
#ifdef IODD_HOST_PROOF
    fputs(text, stdout);
#else
    while (*text) {
        while (!(REG32(0x40004400u) & (1u << 7))) { }
        REG32(0x40004404u) = (uint8_t)*text++;
    }
#endif
}
static int failure(void) {
    emit("IODD_SENSOR_PROOF_FAIL\n");
#ifndef IODD_HOST_PROOF
    /* Bare MCU entry must not return into an unspecified startup tail. */
    for (;;) { __asm__ volatile("nop"); }
#endif
    return 1;
}
#define REQUIRE(condition) do { if (!(condition)) return failure(); } while (0)
static bool write_value(switching_sensor_t *s, uint16_t index, uint16_t value) {
    uint8_t bytes[2] = {(uint8_t)(value >> 8), (uint8_t)value};
    size_t ignored = 0;
    return switching_sensor_service(s, index, 0, true,
        index <= IODD_V_HYSTERESIS_INDEX ? bytes : bytes + 1,
        index <= IODD_V_HYSTERESIS_INDEX ? 2 : 1, NULL, &ignored) == 0;
}
static bool read_value(switching_sensor_t *s, uint16_t index, uint16_t expected) {
    uint8_t bytes[2] = {0, 0}; size_t length = sizeof(bytes);
    if (switching_sensor_service(s, index, 0, false, NULL, 0, bytes, &length) != 0) return false;
    if (index == IODD_V_INVERSION_INDEX) return length == 1 && bytes[0] == expected;
    return length == 2 && (((uint16_t)bytes[0] << 8) | bytes[1]) == expected;
}
static bool decoded(switching_sensor_t *s, uint16_t sample, bool valid, bool output) {
    return iodd_read_bits(s->pd, IODD_PD_IN_BYTES, IODD_PD_IN_FIELD_1_OFFSET, IODD_PD_IN_FIELD_1_BITS) == sample &&
           iodd_read_bits(s->pd, IODD_PD_IN_BYTES, IODD_PD_IN_FIELD_2_OFFSET, IODD_PD_IN_FIELD_2_BITS) == valid &&
           iodd_read_bits(s->pd, IODD_PD_IN_BYTES, IODD_PD_IN_FIELD_3_OFFSET, IODD_PD_IN_FIELD_3_BITS) == output;
}
int main(void) {
#ifndef IODD_HOST_PROOF
    console_init();
#endif
    switching_sensor_t sensor;
    switching_sensor_init(&sensor);
    /* Apply the authored IODD defaults through the real parameter service. */
    REQUIRE(write_value(&sensor, IODD_V_HYSTERESIS_INDEX, 0));
    REQUIRE(write_value(&sensor, IODD_V_SP1_INDEX, IODD_DEFAULT_THRESHOLD));
    REQUIRE(write_value(&sensor, IODD_V_HYSTERESIS_INDEX, IODD_DEFAULT_HYSTERESIS));
    REQUIRE(write_value(&sensor, IODD_V_INVERSION_INDEX, IODD_DEFAULT_INVERSION));
    /* Independent expected values bind this witness to the authored project. */
    REQUIRE(read_value(&sensor, IODD_V_SP1_INDEX, @THRESHOLD@u));
    REQUIRE(read_value(&sensor, IODD_V_HYSTERESIS_INDEX, @HYSTERESIS@u));
    REQUIRE(read_value(&sensor, IODD_V_INVERSION_INDEX, @INVERSION@u));
    emit("DEFAULTS_PASS\n");
    /* Known vectors isolate behavior even for authored zero/max defaults. */
    REQUIRE(write_value(&sensor, IODD_V_HYSTERESIS_INDEX, 0));
    REQUIRE(write_value(&sensor, IODD_V_SP1_INDEX, 1000));
    REQUIRE(write_value(&sensor, IODD_V_HYSTERESIS_INDEX, 100));
    REQUIRE(write_value(&sensor, IODD_V_INVERSION_INDEX, 0));
    REQUIRE(!switching_sensor_sample(&sensor, 999, true));
    REQUIRE(switching_sensor_sample(&sensor, 1000, true));
    REQUIRE(switching_sensor_sample(&sensor, 901, true));
    REQUIRE(!switching_sensor_sample(&sensor, 900, true));
    emit("THRESHOLD_HYSTERESIS_PASS\n");
    REQUIRE(switching_sensor_sample(&sensor, 0x1234, true));
    REQUIRE(sensor.pd[0] == 0x12 && sensor.pd[1] == 0x34 && sensor.pd[2] == 3);
    REQUIRE(decoded(&sensor, 0x1234, true, true));
    emit("BYTE_DECODE_PASS\n");
    REQUIRE(!switching_sensor_sample(&sensor, 0x1234, false));
    REQUIRE(sensor.pd[2] == 0 && decoded(&sensor, 0x1234, false, false));
    REQUIRE(!switching_sensor_sample(&sensor, 950, true));
    REQUIRE(decoded(&sensor, 950, true, false));
    emit("VALIDITY_PASS\n");
    REQUIRE(read_value(&sensor, IODD_V_SP1_INDEX, 1000));
    REQUIRE(read_value(&sensor, IODD_V_HYSTERESIS_INDEX, 100));
    REQUIRE(!write_value(&sensor, IODD_V_HYSTERESIS_INDEX, 1001));
    REQUIRE(!write_value(&sensor, IODD_V_SP1_INDEX, 99));
    REQUIRE(read_value(&sensor, IODD_V_SP1_INDEX, 1000));
    emit("PARAMETER_READBACK_PASS\n");
    REQUIRE(write_value(&sensor, IODD_V_INVERSION_INDEX, 1));
    REQUIRE(switching_sensor_sample(&sensor, 800, true));
    REQUIRE(decoded(&sensor, 800, true, true));
    REQUIRE(write_value(&sensor, IODD_V_TEACH_INDEX, 1));
    REQUIRE(read_value(&sensor, IODD_V_SP1_INDEX, 800));
    REQUIRE(!switching_sensor_sample(&sensor, 800, true));
    REQUIRE(decoded(&sensor, 800, true, false));
    emit("TEACH_INVERSION_PASS\n");
    emit("IODD_SENSOR_PROOF_PASS\n");
#ifdef IODD_HOST_PROOF
    return 0;
#else
    for (;;) { __asm__ volatile("nop"); }
#endif
}
