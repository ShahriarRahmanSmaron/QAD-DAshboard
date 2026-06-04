-- MD-OPQ01: Add first-class dimension columns to operational_facts.
-- sub_unit and department are elevated from potential JSONB storage to
-- proper indexed columns so GROUP BY and filter queries stay fast.
-- WF Test & Shade facts will have NULL in both columns — this is correct.
-- PD Summary facts will populate both from the parser output.

ALTER TABLE operational_facts
  ADD COLUMN IF NOT EXISTS sub_unit   text,
  ADD COLUMN IF NOT EXISTS department text;

-- Indexes matching the existing buyer/unit pattern
CREATE INDEX IF NOT EXISTS operational_facts_sub_unit_date_idx
  ON operational_facts (sub_unit, report_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS operational_facts_department_date_idx
  ON operational_facts (department, report_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS operational_facts_unit_sub_unit_idx
  ON operational_facts (unit, sub_unit)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN operational_facts.sub_unit IS
  'MD-OPQ01: Sub-unit dimension (PD Summary). NULL for WF Test & Shade and other parsers.';
COMMENT ON COLUMN operational_facts.department IS
  'MD-OPQ01: Department dimension (PD Summary). NULL for WF Test & Shade and other parsers.';
