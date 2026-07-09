<!--
  Registry listing submission (spec-08 §3).
  Use this template when adding your registry to `registries.json`:
  open your PR with `?template=registry-listing.md` appended to the compare URL.
-->

## Registry listing request

**This is a listing review, not a code audit** — merging this PR means the
entry was checked against the checklist below, and nothing more. `trust:
"listed"` never asserts that your blocks are safe; users verify blocks
themselves (`ion-drive block verify`, digest checks at `add` time).

### The entry

Paste the object you are adding to `registries.json` → `registries[]`:

```json
{
  "namespace": "@acme",
  "url": "https://blocks.acme.example/registry/index.json",
  "owner": "Acme Corp",
  "description": "Acme's Ion Drive blocks.",
  "repository": "https://github.com/acme/ion-drive-blocks"
}
```

### Submitter checklist

- [ ] `url` is public **HTTPS** and serves a valid protocol-v1 `index.json`
      (`ion-drive registry add @probe <url>` against a scratch project passes).
- [ ] `namespace` matches the grammar (`@[a-z][a-z0-9-]*`), is not a
      name-grab of a brand/product I don't represent, and does not collide
      with an existing entry (first-come-first-served).
- [ ] `owner` and a working contact (repo issues or email) are present and
      accurate.
- [ ] `description` accurately describes what the registry hosts.

### Reviewer notes

Run the checklist in `docs/registry-operations.md` § "Reviewing a
registries-directory PR" (includes a spot-check install of one block). Once
merged, `ion-drive registry add @<namespace>` resolves the entry from the
directory.
