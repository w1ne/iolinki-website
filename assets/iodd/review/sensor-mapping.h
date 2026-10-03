/* Generated IODD mapping. Bit offsets follow IODD; serialize wire bytes explicitly. */
#ifndef IOLINKI_IODD_MAPPING_H
#define IOLINKI_IODD_MAPPING_H
#include <stdint.h>
#include <stddef.h>
#define IODD_VENDOR_ID 1234u
#define IODD_DEVICE_ID 5679u
#define IODD_V_SP1_INDEX 256u
#define IODD_V_HYSTERESIS_INDEX 257u
#define IODD_V_INVERSION_INDEX 258u
#define IODD_V_TEACH_INDEX 259u
#define IODD_PD_IN_BITS 24u
#define IODD_PD_IN_BYTES 3u
#define IODD_PD_IN_FIELD_1_SUBINDEX 1u
#define IODD_PD_IN_FIELD_1_OFFSET 8u
#define IODD_PD_IN_FIELD_1_BITS 16u
#define IODD_PD_IN_FIELD_2_SUBINDEX 2u
#define IODD_PD_IN_FIELD_2_OFFSET 1u
#define IODD_PD_IN_FIELD_2_BITS 1u
#define IODD_PD_IN_FIELD_3_SUBINDEX 3u
#define IODD_PD_IN_FIELD_3_OFFSET 0u
#define IODD_PD_IN_FIELD_3_BITS 1u
/* Byte 0 is most significant. Offset 0 is bit 0 of the final byte.
 * Callers use the *_BYTES, *_OFFSET and *_BITS constants above.
 * Bounds failures return 0; no packed C structs or host endianness assumptions. */
static inline uint64_t iodd_read_bits(const uint8_t *data, size_t bytes, unsigned offset, unsigned bits) {
  uint64_t value = 0;
  if (!data || bits > 64u || offset > bytes * 8u || bits > bytes * 8u - offset) return 0;
  for (unsigned i = 0; i < bits; ++i) {
    unsigned position = offset + i;
    value |= (uint64_t)((data[bytes - 1u - position / 8u] >> (position % 8u)) & 1u) << i;
  }
  return value;
}
static inline int iodd_write_bits(uint8_t *data, size_t bytes, unsigned offset, unsigned bits, uint64_t value) {
  if (!data || bits > 64u || offset > bytes * 8u || bits > bytes * 8u - offset) return 0;
  for (unsigned i = 0; i < bits; ++i) {
    unsigned position = offset + i;
    size_t byte = bytes - 1u - position / 8u;
    uint8_t mask = (uint8_t)(1u << (position % 8u));
    data[byte] = (uint8_t)((data[byte] & (uint8_t)~mask) | (((value >> i) & 1u) ? mask : 0u));
  }
  return 1;
}
#endif
