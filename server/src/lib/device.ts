// A browser as a person would name it ("Chrome · Windows", "Safari · iPhone"), from its User-Agent: what sign-ins,
// sign-in attempts and devices with push show in the admin panel. Nothing else of the User-Agent is kept.

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\b(?:OPR|Opera)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bYaBrowser\//, 'Yandex'],
  [/\bVivaldi\//, 'Vivaldi'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*Safari\//, 'Safari'],
];

const SYSTEMS: [RegExp, string][] = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bWindows\b/, 'Windows'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

/** "Chrome · Windows"; null without a User-Agent. */
export function deviceOf(userAgent: string | string[] | undefined): string | null {
  const ua = (Array.isArray(userAgent) ? userAgent[0] : userAgent)?.slice(0, 500);
  if (!ua) return null;
  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1];
  const named = [browser, system].filter(Boolean).join(' · ');
  return (named || ua.split(/[\s/(]/)[0] || 'Unknown').slice(0, 80);
}
