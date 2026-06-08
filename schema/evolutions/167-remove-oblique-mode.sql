START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 166 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

-- Remove oblique from allowedModes arrays and clear preferredMode where it was oblique
UPDATE webknossos.taskTypes
  SET settings_allowedModes = array_remove(settings_allowedModes, 'oblique'::webknossos.TASKTYPE_MODES)
  WHERE 'oblique'::webknossos.TASKTYPE_MODES = ANY(settings_allowedModes);

UPDATE webknossos.taskTypes
  SET settings_preferredMode = NULL
  WHERE settings_preferredMode = 'oblique'::webknossos.TASKTYPE_MODES;

-- Recreate the enum without oblique and migrate columns to it
CREATE TYPE webknossos.TASKTYPE_MODES_new AS ENUM ('orthogonal', 'flight', 'volume');

ALTER TABLE webknossos.taskTypes
  ALTER COLUMN settings_allowedModes DROP DEFAULT;

ALTER TABLE webknossos.taskTypes
  ALTER COLUMN settings_allowedModes TYPE webknossos.TASKTYPE_MODES_new[]
  USING settings_allowedModes::text[]::webknossos.TASKTYPE_MODES_new[];

ALTER TABLE webknossos.taskTypes
  ALTER COLUMN settings_allowedModes SET DEFAULT '{orthogonal, flight}';

ALTER TABLE webknossos.taskTypes
  ALTER COLUMN settings_preferredMode TYPE webknossos.TASKTYPE_MODES_new
  USING settings_preferredMode::text::webknossos.TASKTYPE_MODES_new;

DROP TYPE webknossos.TASKTYPE_MODES;
ALTER TYPE webknossos.TASKTYPE_MODES_new RENAME TO TASKTYPE_MODES;

UPDATE webknossos.releaseInformation SET schemaVersion = 167;

COMMIT TRANSACTION;
