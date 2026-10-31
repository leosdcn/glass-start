# Contributing

[简体中文](./CONTRIBUTING.md) · **English**

> The [Simplified Chinese documentation](./CONTRIBUTING.md) is the primary maintained version. This English version is a translation. If anything is unclear or inconsistent, the Chinese version takes precedence. Translation corrections are welcome. The project's open-source license is governed by the original [LICENSE](./LICENSE) file.

Thank you for your interest in **Glass Start**. Contributions are welcome.

The project follows the principle **“Entities should not be multiplied beyond necessity”**, aiming to stay minimal, clear and efficient.

---

## 1. Read before contributing

Before changing code or submitting a pull request, read:

- **[README.en.md](./README.en.md)**: user guide, requirements, local development and testing.
- **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** (Chinese): module responsibilities, state flow, overlay management and caching.
- **[AGENTS.md](./AGENTS.md)** (Chinese): implementation constraints, change boundaries and validation requirements by risk. These project instructions apply to contributions regardless of the interface language.

---

## 2. Contribution guidelines

1. **Make the smallest necessary change.** Avoid extra abstractions or elaborate scaffolding added only for completeness. Reuse existing code where possible.
2. **Avoid adding runtime dependencies.** Prefer native Web APIs. If a third-party runtime library is necessary, explain its benefit and check bundle size, initial rendering performance and offline compatibility.
3. **Choose bookmarks for everyday needs.** Exclude shopping sites and cloud storage services with poor usability, aggressive upselling or excessive restrictions. Avoid heavy advertising, forced redirects and download prompts. Prefer tools that work without signing in or installing software. Source descriptions in `bookmarks.json` are limited to 9 characters for Chinese-only text or 13 when Latin letters or numbers are present. English descriptions in `src/js/config/locales/catalog-en.json` are limited to 28 characters, including spaces and punctuation. See the [full selection criteria](./README.en.md#bookmark-selection-criteria).
4. **Validate according to impact.** Follow the [validation rules in AGENTS.md](./AGENTS.md#验证) (Chinese). Documentation, comments and formatting changes with no behavior impact need only a review of diffs, links and commands. For behavior changes, run lint, directly relevant tests and type checking where required. Complete the release checks before a release. Chrome is the browser acceptance baseline, including simulated mobile viewports and touch interactions; testing in Safari or on physical iOS devices is not required.
5. **Develop the extension from its sources.** Shared pages and behavior live in `src/`; the extension manifest and icons live in `src/extension/`. Do not edit the generated `extension/` folder. Run `npm test -- infra-chrome-extension` for extension changes, and relevant web tests when website behavior also changes. See the [extension installation guide](./README.en.md#chrome-new-tab-extension) for loading and updating it. Check both host permissions and CSP when adding a network endpoint.
6. **Keep localization consistent.** Interface messages live in `src/js/config/locales/en.json` and `zh-CN.json`; keep keys and interpolation parameters aligned. English category names, bookmark names and descriptions are in `catalog-en.json`, matched to stable category IDs and shared URLs. Keep the complete catalog in `bookmarks.json`, using international URLs. Put Chinese destination overrides in `catalog-zh-CN.json` and English overrides in the optional `url` field in `catalog-en.json`. Prefer shared URLs for sites that select their language automatically. When removing a Chinese destination override, retain its old URL as `legacyUrl` for saved-link compatibility. English default quick bookmarks are configured by `defaultBookmarks` there and reuse the shared catalog. Do not overwrite saved user choices or translate custom and imported text. Run `npm run lint` to check the translation contract.
7. **Keep bilingual documentation in sync.** When changing the README or contribution guide, or the features, commands or configuration they describe, update the corresponding Chinese and English versions together so the instructions remain consistent.

---

## 3. License

Code contributions are accepted under the [GNU General Public License v3.0 (GPL-3.0-or-later)](./LICENSE).
