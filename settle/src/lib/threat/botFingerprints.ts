// Bundled list of known low-entropy / headless-browser fingerprint signatures.
// These are NOT exact visitor_id hashes (those change with any component
// shift); they're substring signatures of well-known automation environments
// that show up in the components blob.
//
// When any signature matches the components serialised form, the actor
// receives DEVICE_FP_LOW_ENTROPY.

export interface BotSignature {
  id: string;
  description: string;
  /** Case-insensitive substring that, if present in the components JSON,
   *  marks the fingerprint as bot-flavoured. */
  match: string;
}

export const BOT_SIGNATURES: BotSignature[] = [
  // Headless Chrome — the dominant automation flavour. Appears in WebGL
  // renderer string ("Google SwiftShader") and user-agent.
  { id: 'headless_chrome_ua', description: 'Headless Chrome user-agent',
    match: 'HeadlessChrome' },
  { id: 'headless_chrome_swiftshader', description: 'Headless Chrome SwiftShader WebGL',
    match: 'SwiftShader' },

  // Puppeteer / Playwright fingerprints — usually betray themselves via
  // missing plugins + missing languages + automation-controller WebDriver flag.
  { id: 'webdriver_present', description: 'navigator.webdriver flag set',
    match: '"webdriver":true' },

  // PhantomJS — legacy but still appears.
  { id: 'phantomjs', description: 'PhantomJS automation',
    match: 'PhantomJS' },

  // Selenium-style canvas signature — the canvas rendering on Selenium-driven
  // Chrome produces a flat colour rather than the standard antialiased glyph.
  // Matched via the canvas-fingerprint marker our collector embeds.
  { id: 'flat_canvas', description: 'Flat / constant-colour canvas (Selenium / VM)',
    match: '"canvas_fp":"flat:' },

  // Common emulator user-agents.
  { id: 'electron_app', description: 'Electron embedded browser',
    match: 'Electron' },

  // No-plugin Chrome — desktop Chrome with literally zero plugins is
  // overwhelmingly headless. (Real desktop Chrome has 5+ default plugins.)
  { id: 'zero_plugins_chrome', description: 'Desktop Chrome with no plugins',
    match: '"plugins":[],' },

  // Headless Firefox (Mozilla's --headless mode).
  { id: 'headless_firefox_ua', description: 'Headless Firefox user-agent',
    match: 'rv:0' },
];

/**
 * Returns the first matching signature, or null. Operates on the canonical
 * JSON serialisation of the components blob.
 */
export function matchBotSignature(componentsJson: string): BotSignature | null {
  const haystack = componentsJson; // already canonical JSON
  for (const sig of BOT_SIGNATURES) {
    if (haystack.includes(sig.match)) return sig;
  }
  return null;
}
