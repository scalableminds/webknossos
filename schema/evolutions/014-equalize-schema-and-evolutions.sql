-- https://github.com/scalableminds/webknossos/pull/2742

-- This applies 2 steps, to make sure that schema.sql and all evolutions agree:
-- 1. make the dataSets displayName column a VARCHAR
-- 2. give the tasks checks proper names
--    (this is necessary because an outdated schema.sql used unnamed checks before)

START TRANSACTION;

-- Altering the column is only possible without the view.
DROP VIEW webknossos.dataSets_;
ALTER TABLE webknossos.dataSets ALTER COLUMN displayName TYPE VARCHAR(256) USING rtrim(displayName);
CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;

-- ALTER TABLE … RENAME CONSTRAINT … does not have IF EXISTS,
-- therefore handling all possible cases here with DROP and ADD:
ALTER TABLE webknossos.tasks DROP CONSTRAINT IF EXISTS tasks_check;
ALTER TABLE webknossos.tasks DROP CONSTRAINT IF EXISTS tasks_openinstances_check;
ALTER TABLE webknossos.tasks DROP CONSTRAINT IF EXISTS openInstancesSmallEnoughCheck;
ALTER TABLE webknossos.tasks DROP CONSTRAINT IF EXISTS openInstancesLargeEnoughCheck;
ALTER TABLE webknossos.tasks ADD CONSTRAINT openInstancesSmallEnoughCheck CHECK (openInstances <= totalInstances);
ALTER TABLE webknossos.tasks ADD CONSTRAINT openInstancesLargeEnoughCheck CHECK (openInstances >= 0);

COMMIT TRANSACTION;
