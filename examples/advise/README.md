# Constraint advisor samples (v0.7)

Produced by `npm run smoke:advise`:

| File | Role |
|------|------|
| `antonio-stripped-for-advise.fet` | NL Antonio build **without** MinDays / SameStartingTime / preferred rooms |
| `antonio-advised.fet` | After `fet_advise` + apply high-confidence |
| `antonio-advised.summary.json` | Smoke report |

Source prose: `../from-nl/antonio-orario-completo.txt`.

Remember: the advisor writes constraints; `fet_generate` still creates the timetable.
