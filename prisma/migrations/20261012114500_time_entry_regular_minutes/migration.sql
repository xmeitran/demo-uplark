-- D-14: every time entry states its hour type. Rows written before the split kept regularMinutes = 0;
-- nothing was ever logged as overtime, so their standard hours are the whole entry.
UPDATE "TaskTimeEntry"
SET "regularMinutes" = "minutes" - "overtimeMinutes"
WHERE "regularMinutes" <> "minutes" - "overtimeMinutes";
