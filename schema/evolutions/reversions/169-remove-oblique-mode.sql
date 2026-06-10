START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 169 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

-- Recreate the enum with oblique and migrate columns back.
-- The taskTypes_ view depends on the columns being altered, so drop and recreate it.
DROP VIEW webknossos.taskTypes_;

CREATE TYPE webknossos.TASKTYPE_MODES_old AS ENUM ('orthogonal', 'flight', 'oblique', 'volume');

ALTER TABLE webknossos.taskTypes
  ALTER COLUMN settings_allowedModes DROP DEFAULT;

ALTER TABLE webknossos.taskTypes
  ALTER COLUMN settings_allowedModes TYPE webknossos.TASKTYPE_MODES_old[]
  USING settings_allowedModes::text[]::webknossos.TASKTYPE_MODES_old[];

ALTER TABLE webknossos.taskTypes
  ALTER COLUMN settings_allowedModes SET DEFAULT '{orthogonal, flight, oblique}';

ALTER TABLE webknossos.taskTypes
  ALTER COLUMN settings_preferredMode DROP DEFAULT;

ALTER TABLE webknossos.taskTypes
  ALTER COLUMN settings_preferredMode TYPE webknossos.TASKTYPE_MODES_old
  USING settings_preferredMode::text::webknossos.TASKTYPE_MODES_old;

ALTER TABLE webknossos.taskTypes
  ALTER COLUMN settings_preferredMode SET DEFAULT 'orthogonal';

DROP TYPE webknossos.TASKTYPE_MODES;
ALTER TYPE webknossos.TASKTYPE_MODES_old RENAME TO TASKTYPE_MODES;

CREATE VIEW webknossos.taskTypes_ AS SELECT * FROM webknossos.taskTypes WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 168;

COMMIT TRANSACTION;
