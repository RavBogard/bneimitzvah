# CRC Torah logo: provenance

## What these files are

Derivatives of Siona Benjamin's floor mural at Central Reform Congregation, the CRC Torah logo.

## Permission

Used under permission held by Central Reform Congregation; Daniel Bogard confirmed on 2026-10-26 that CRC has permission and that copies of 512 px and under may be committed.

## Rule

No copy larger than 512 px enters this repository; the full-resolution masters are kept outside it.

The repository policy (scripts/font-assets.mjs, checked by tests/never-in-repo.test.mjs) accepts each file below only at its exact path with exactly these bytes, only beside this notice, and only when its own header declares no side larger than 512 px. Any other PNG, WebP or ICO image is refused.

## How they were made

From a 1335 px transparent PNG master:

1. Trimmed to the mural and squared.
2. Resized with Lanczos.
3. Small sizes: saturation 1.15 and a 0.6 sharpen.
4. App icons composited on #1d5ba6 with the mural at 86% of the canvas (maskable at 78%).
5. PNGs palette-quantised at quality 92.
6. favicon.ico packs the 16, 32 and 48 px PNGs.

## Files

| Path | Pixels | Bytes | SHA-256 |
| --- | --- | --- | --- |
| public/brand/mural-64.webp | 64 x 64 | 3474 | a61508b3153fcdb863e41653ed0b8f46798960373f5a1ed95a802cc108b6f643 |
| public/brand/mural-128.webp | 128 x 128 | 9832 | d121a030ea2a26bd9692b889b07d7f07d28d3d433eb30d05a35daf075b740cf7 |
| public/brand/mural-512.png | 512 x 512 | 169331 | c08a20644f9516806b876e959b881c83476dea1eaa195f140a85319846142735 |
| public/brand/icon-192.png | 192 x 192 | 21806 | d843a248e193cdce3e662ebb36b56eb123d5dbf685040a6c741ad83b39a29481 |
| public/brand/icon-512.png | 512 x 512 | 129874 | a0db7e7769cd0337655a3e0cccf40549462cfe02e2bef16f2107528c9b922b5d |
| public/brand/maskable-512.png | 512 x 512 | 108926 | 0e7ff2d46ff3b9395d2a68adc09ec210fe1beb1c7beedf30928c3411038670e2 |
| public/brand/apple-180.png | 180 x 180 | 19458 | b2f7fc0a773f0ae8fa7f843cb88caf2a10751a6971fded21eb970a46f20e5f7d |
| public/brand/favicon-48.png | 48 x 48 | 3095 | 1099e746347ec41ae60c79dbab809b0d75cb4ae425f8d48403bc85e4661d5b81 |
| public/brand/favicon.ico | 16, 32 and 48 px | 11376 | e22679cbb4bb9123aeb9eb9249c80f84a2a521a5fb3f4c53f7a83f4917c32f7b |
