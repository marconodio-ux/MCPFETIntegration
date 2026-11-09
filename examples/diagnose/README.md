# Diagnose examples (MFI-5)

- `teacher-unavailable-conflict.fet` — intentionally impossible Official file: teacher **Rossi Mario** has activities but `ConstraintTeacherNotAvailableTimes` at 100% covers every slot. Static `fet_diagnose` should report `teacher_fully_unavailable` / `teacher_hours_overflow`.
- `sample-logs/` — synthetic FET-CL `logs/` tree (`errors.txt`, `result.txt`, `difficult_activities.txt`) for log-parser smoke when `fet-cl` is not installed.

```powershell
npm run smoke:diagnose
```
