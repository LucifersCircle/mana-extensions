# VortexScans for Mana

This repository contains one Mana extension: **VortexScans**.

Mana repository URL: `https://mana.pirate.vodka/sources.json`

The implementation is a native Mana port of the Paperback VortexScans source
from [pirate.vodka extensions](https://github.com/LucifersCircle/pirate.vodka-extensions/tree/0.9/stable/src/VortexScans).

## Features

- Dynamic discovery rows for Popular Today, Latest, New, every published
  collection, and Most Popular
- Search with the live VortexScans genre list, include/exclude genre selection,
  status, type, and sorting filters
- Manga, manhwa, and manhua metadata
- Free chapter discovery with locked chapters excluded
- Ordered webtoon pages from the VortexScans API, with an HTML fallback
- Cloudflare and vShield challenge detection through Mana's built-in resolution flow
- VortexScans deep-link handling and image request headers

## Development

```sh
npm install
npm test
npm run typecheck
npm run prep
npm run serve
```

The test repository is then available at
`http://127.0.0.1:8080/sources.json`. Use `npm run dev` instead when you want
the server to restart automatically after TypeScript changes.

The source is in [`src/sources/VortexScans`](src/sources/VortexScans) and its
icon is [`assets/VortexScans.png`](assets/VortexScans.png).

## Upstream behavior

The port follows the reworked
[Paperback VortexScans source](https://github.com/LucifersCircle/pirate.vodka-extensions/tree/0.9/stable/src/VortexScans),
while using the live VortexScans JSON detail and chapter endpoints where they
are more reliable than the upstream source's now-stale Astro page parser.

Licensed under [GPL-3.0-or-later](LICENSE).
