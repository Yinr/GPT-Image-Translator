# Pic2API Notes

## Scope

This note tracks `pic2api` behavior that differs from the default OpenAI image-edit assumptions in
this repository. It is not intended to copy the provider's entire public documentation. It records
only the constraints and extensions that matter for this translator.

Reference source used during implementation planning:

- Original provider docs: `https://www.pic2api.com/user/api-docs`
- Local snapshot: `.local/doc/pic2api.md`

## Confirmed Relevant Endpoints

- `POST /v1/images/generations`: image generation
- `POST /v1/chat/completions`: image generation with chat-style multimodal input
- `GET /v1/models`: model list

The provider documentation claims OpenAI-compatible support, so the translator should continue to
prefer the existing OpenAI-compatible image-edit path first unless a concrete incompatibility is
confirmed.

## GPT-Image-2 Differences

### Size behavior

- `gpt-image-2` on `pic2api` does not support AUTO size behavior.
- If `size="auto"`, `aspect_ratio="auto"`, or both fields are omitted, the provider may fall back to
  a native `1:1` output.
- The provider documentation describes `size` as pixel dimensions (`WxH`) and lists recommended
  sizes for 1K, 2K, and 4K tiers.

Recommended sizes documented by the provider:

- 1K: `1024x1024`, `1280x720`, `720x1280`, `1536x1024`, `1024x1536`, `1152x864`, `864x1152`,
  `1120x896`, `896x1120`, `1456x624`
- 2K: `2048x2048`, `2560x1440`, `1440x2560`, `2496x1664`, `1664x2496`, `2304x1728`, `1728x2304`,
  `2240x1792`, `1792x2240`, `3024x1296`
- 4K: `2480x2480`, `3328x1872`, `1872x3328`, `3056x2032`, `2032x3056`, `2880x2160`, `2160x2880`,
  `2784x2224`, `2224x2784`, `3808x1632`

Current repository decision:

- Keep the existing fixed OpenAI-style image-edit path and aspect-pad preprocessing for now.
- `pic2api + gpt-image-2 + size:auto` should resolve to the nearest documented recommended size from
  the provider list, based on source-image ratio and the current quality tier.
- Keep current preprocessing and crop-back behavior even after that size selection is introduced.
- Do not yet expose arbitrary provider-native `WxH` sizes in user config.

### Quality behavior

The provider documentation maps quality-like values to resolution tiers:

- `standard` / `1k` -> 1K
- `hd` / `2k` -> 2K
- `4k` / `high` / `ultra` -> 4K

Current repository decision:

- Keep the existing user-facing quality values for now.
- Add provider-aware quality-to-tier mapping later if `pic2api` mode is introduced.

## Image Editing Extensions Not Yet Adopted

The provider documentation includes additional flows not yet used by this repository:

- `POST /v1/chat/completions` with `image_url` parts for image-to-image and multi-image input
- `POST /v1/images/generations` with `image_urls`
- AUTO aspect-ratio behavior for non-`gpt-image-2` models

Current repository decision:

- Do not add these provider-specific flows yet.
- Record them for future provider-specific implementation when the client abstraction is expanded.

## Error Handling Notes

The provider documents these status codes as relevant:

- `401`: invalid or expired API key
- `402`: insufficient balance
- `403`: forbidden
- `429`: rate limited
- `500`: server error
- `502`: upstream unavailable

Future work:

- Review whether `402` should be treated as a stop-run error for single-provider/single-key runs.
