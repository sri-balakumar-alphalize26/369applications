// Derive a short, stable 10-digit device code from the raw OS device id
// (Android ID / iOS vendor id). Deterministic — the same phone always produces
// the same code — so it's as stable as the OS id, just short enough for HR to
// type when registering a device.
//
// FNV-1a 32-bit hash → unsigned int → left-padded to 10 digits. 32-bit space
// (~4.3B) makes collisions negligible for a company-sized device fleet.
export const toShortDeviceCode = (raw) => {
  const s = String(raw || '');
  if (!s) return '';
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  // >>> 0 → unsigned 32-bit; pad so it's always exactly 10 digits.
  return (h >>> 0).toString().padStart(10, '0');
};

export default toShortDeviceCode;
