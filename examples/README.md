# Examples

- `sample-school.fet` — small FET XML sample copied from the official FET-7.12.0 examples tree (for load/validate smoke tests).
- `from-assignments/` — MFI-4 text→`.fet` sample:
  - `sample-incarichi.txt` — Italian teacher workloads
  - `sample-from-assignments.fet` — generated Official file (`npm run smoke:assignments`)
- `from-nl/` — MFI-8 natural language→`.fet` (Antonio scenario):
  - `antonio-orario.txt` / `antonio-orario-completo.txt`
  - `antonio-from-nl.fet` — generated Official file (`npm run smoke:nl`)
- `advise/` — MFI-12 constraint advisor smoke (`npm run smoke:advise`): stripped → advised `.fet`
- `real/` — MFI-9 notes only (no institute `.fet` here; optional local smoke uses a folder **outside** this repo)
- `diagnose/` — MFI-5 intentionally conflicting `.fet` + sample `logs/` (`npm run smoke:diagnose`)

Larger official examples appear under `vendor/fet-src/fet-7.12.0/examples/` after `npm run fetch-fet`.

**Privacy:** real institute `.fet` stay outside this repository. ChatGPT/`fet_list_examples` must only see synthetic samples.
