const BASE_CHROME_FLAGS = [
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-default-apps',
    '--disable-breakpad',
    '--disable-crash-reporter',
    '--noerrdialogs',
    '--disable-client-side-phishing-detection',
    '--disable-component-extensions-with-background-pages',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--password-store=basic',
    '--use-mock-keychain',
    '--mute-audio',
];

module.exports = { BASE_CHROME_FLAGS };
