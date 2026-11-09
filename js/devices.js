// Physical screen size of common Apple devices (2021 onwards), so the app
// knows how many cm one CSS pixel is. Diagonal (inches) and native panel
// resolution (long × short side) per Apple's published specs; the width in
// cm follows from those. Devices with the same panel share an entry.
// `css` = CSS-pixel size (long × short) used to recognise the device;
// for Macs it is the default "looks like" resolution.
export const DEVICES = [
  { id: 'iphone-se3', group: 'iPhone', name: 'iPhone SE (2022)', diag: 4.7, px: [1334, 750], css: [667, 375] },
  { id: 'iphone-54', group: 'iPhone', name: 'iPhone 13 mini', diag: 5.4, px: [2340, 1080], css: [812, 375] },
  { id: 'iphone-61a', group: 'iPhone', name: 'iPhone 13 / 13 Pro / 14 / 16e', diag: 6.1, px: [2532, 1170], css: [844, 390] },
  { id: 'iphone-61b', group: 'iPhone', name: 'iPhone 14 Pro / 15 / 15 Pro / 16', diag: 6.1, px: [2556, 1179], css: [852, 393] },
  { id: 'iphone-63', group: 'iPhone', name: 'iPhone 16 Pro / 17 / 17 Pro', diag: 6.3, px: [2622, 1206], css: [874, 402] },
  { id: 'iphone-65', group: 'iPhone', name: 'iPhone Air', diag: 6.5, px: [2736, 1260], css: [912, 420] },
  { id: 'iphone-67a', group: 'iPhone', name: 'iPhone 13 Pro Max / 14 Plus', diag: 6.7, px: [2778, 1284], css: [926, 428] },
  { id: 'iphone-67b', group: 'iPhone', name: 'iPhone 14 Pro Max / 15 Plus / 15 Pro Max / 16 Plus', diag: 6.7, px: [2796, 1290], css: [932, 430] },
  { id: 'iphone-69', group: 'iPhone', name: 'iPhone 16 Pro Max / 17 Pro Max', diag: 6.9, px: [2868, 1320], css: [956, 440] },

  { id: 'ipad-mini', group: 'iPad', name: 'iPad mini (6. / 7. Gen.)', diag: 8.3, px: [2266, 1488], css: [1133, 744] },
  { id: 'ipad-102', group: 'iPad', name: 'iPad (9. Gen.)', diag: 10.2, px: [2160, 1620], css: [1080, 810] },
  { id: 'ipad-109', group: 'iPad', name: 'iPad (10. / 11. Gen.), iPad Air 10,9" / 11"', diag: 10.9, px: [2360, 1640], css: [1180, 820] },
  { id: 'ipad-pro11', group: 'iPad', name: 'iPad Pro 11" (M1 / M2)', diag: 11, px: [2388, 1668], css: [1194, 834] },
  { id: 'ipad-pro11m4', group: 'iPad', name: 'iPad Pro 11" (M4 / M5)', diag: 11.1, px: [2420, 1668], css: [1210, 834] },
  { id: 'ipad-129', group: 'iPad', name: 'iPad Pro 12,9" (M1 / M2), iPad Air 13"', diag: 12.9, px: [2732, 2048], css: [1366, 1024] },
  { id: 'ipad-pro13m4', group: 'iPad', name: 'iPad Pro 13" (M4 / M5)', diag: 13, px: [2752, 2064], css: [1376, 1032] },

  { id: 'mac-133', group: 'MacBook', name: 'MacBook Air 13" (M1), MacBook Pro 13" (M1 / M2)', diag: 13.3, px: [2560, 1600], css: [1440, 900] },
  { id: 'mac-136', group: 'MacBook', name: 'MacBook Air 13" (M2 – M4)', diag: 13.6, px: [2560, 1664], css: [1470, 956] },
  { id: 'mac-153', group: 'MacBook', name: 'MacBook Air 15" (M2 – M4)', diag: 15.3, px: [2880, 1864], css: [1710, 1112] },
  { id: 'mac-142', group: 'MacBook', name: 'MacBook Pro 14" (M1 Pro – M5)', diag: 14.2, px: [3024, 1964], css: [1512, 982] },
  { id: 'mac-162', group: 'MacBook', name: 'MacBook Pro 16" (M1 Pro – M4)', diag: 16.2, px: [3456, 2234], css: [1728, 1117] },
];

// Long side of the physical screen in cm.
export const longSideCm = (d) => d.diag * 2.54 * d.px[0] / Math.hypot(d.px[0], d.px[1]);

const screenLong = () => Math.max(screen.width, screen.height);
const screenShort = () => Math.min(screen.width, screen.height);

// Guess the device from the screen's CSS size. Returns null if unknown
// (external monitor, changed display scaling, Android, …).
export function detectDevice() {
  const L = screenLong(), S = screenShort();
  return DEVICES.find((d) => Math.abs(d.css[0] - L) <= 2 && Math.abs(d.css[1] - S) <= 2) || null;
}

// cm per CSS pixel. setting = 'auto' | device id | 'custom'; customCm = long
// side in cm for 'custom'. Falls back to ~0.019 cm, close for most Apple screens.
export function cmPerCssPx(setting, customCm) {
  if (setting === 'custom' && parseFloat(customCm) > 0) return parseFloat(customCm) / screenLong();
  const d = (setting && setting !== 'auto' && setting !== 'custom') ? DEVICES.find((x) => x.id === setting) : detectDevice();
  return d ? longSideCm(d) / screenLong() : 0.019;
}
