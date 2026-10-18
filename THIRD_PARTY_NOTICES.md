# Third-party notices

ClearGive's own code is MIT-licensed (see `LICENSE`, including its scope note). This file covers everything that is **not** the team's original work.

## npm dependencies

The exact versions are pinned in `pnpm-lock.yaml`. Dependencies are installed from the npm registry and are not committed to this repository.

| Package | Version | Licence | How ClearGive uses it |
| --- | --- | --- | --- |
| `@openzeppelin/contracts` | 5.4.0 | MIT | Imported by the Solidity contracts (ERC-20, SafeERC20, ReentrancyGuard and related contracts) |
| `ethers` | 6.15.0 | MIT | Contract calls; bundled into `dist/app.js`, `dist/live.js` and `dist/_worker.js` |
| `ganache` | 7.9.2 | MIT | In-browser local EVM; `dist/ganache.min.js` is copied unmodified from the package |
| `memdown` | 6.1.1 | MIT | In-memory database adapter for the prepared-chain checkpoint |
| `buffer` | 6.0.3 | MIT | Browser `Buffer` shim |
| `esbuild` | 0.25.10 | MIT | Build tool only |
| `solc` | 0.8.30 | MIT (JavaScript wrapper) | Build tool only. The bundled Solidity compiler (`soljson.js`) is distributed by the Solidity project under GPL-3.0. ClearGive does not redistribute the compiler. |

Transitive dependencies keep their own licences. `pnpm build` copies the Ganache and ethers licence texts, and the Ganache bundle's own third-party notice file, into `dist/licenses/`. Anyone who deploys `dist/` should keep that folder. esbuild keeps the legal comments of bundled code at the end of each bundle (`legalComments: 'eof'`).

## Web fonts

The pages load **DM Sans**, **Manrope** and **Lora** at runtime from Google Fonts (`fonts.googleapis.com`). These fonts are licensed under the SIL Open Font License 1.1 and are not stored in this repository. Without network access, the pages fall back to system fonts.

## Campaign photographs: not included

The hosted demo showed 13 representative stock photographs. They are credited in `public/photo-credits.html` as Pexels photographs, used under the Pexels License.

**This repository does not redistribute those photographs.** Each file in `public/assets/*.jpg` has been replaced by a generated placeholder with the same file name and dimensions, so the demo and tests run unchanged. Reasons:

1. **Embedded metadata conflicts with the credits.** For `pantry.jpg`, `seniors.jpg` and `study.jpg`, the embedded EXIF/XMP author does not match the photographer credited on the credits page. The source of those files therefore could not be confirmed.
2. **The other photographs could not be checked either.** The Pexels pages could not be opened from the release environment.
3. **Attribution is not the same as permission.** Even under the Pexels License, publishing the image files in a public source repository is a redistribution decision. It is made separately from crediting them on a website.

To restore the photographs locally or in your own deployment:

- download each one from its credited Pexels page, confirming the photographer and licence there;
- save it under the same file name in `public/assets/`;
- run `pnpm build`.

Do not commit photographs back to this repository unless their source and redistribution terms have been confirmed.

The four SVG illustrations (`community.svg`, `garden.svg`, `pantry.svg`, `school.svg`) and `mark.svg` are simple hand-coded vector files from the original project. They are treated as team-original.

Placeholder accessibility note: some `alt` texts in `src/app.js` and `src/campaign-content.js` still describe the original photographs.

## Presentation (`docs/presentation/ClearGive_Presentation.pptx`)

The presentation is a **sanitised public copy** of the team's course presentation:

- student ID numbers and member names were removed from the cover;
- personal names were removed from the file metadata;
- an application-specific custom property block was removed.

It is included for reference only and is not covered by the MIT licence.

- **Statistics, report findings and competitor information** belong to the sources cited on the slides and in the reference list (slide 14). They are quoted for commentary and are not relicensed.
- **The cover and problem-statement artwork** is described in the speaker notes as AI-generated conceptual illustration from the team's draft deck. Which tool was used, and its terms, were not recorded. Do not reuse these images outside this reference copy until that is confirmed.
- **Icons** were rendered from the Lucide icon set (via `react-icons/lu`), licensed under ISC.
- **Screenshots** show the ClearGive demo with fictional participants.

## Demo data

All campaign titles, organisations, people (for example "Alex Morgan", "Mei Tan", "Daniel Wong") and suppliers in the demo and its prepared checkpoint are fictional. Locations are only used as scene-setting. The demo token CGUSD is a local test token with no monetary value.
