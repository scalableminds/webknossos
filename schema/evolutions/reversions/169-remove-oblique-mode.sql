START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 169 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

-- Recreate the enum with oblique and migrate columns back
CREATE TYPE webknossos.TASKTYPE_MODES_old AS ENUM ('orthogonal', 'flight', 'oblique', 'volume');

ALTER TABLE webknossos.taskTypes
  ALTER COLUMN settings_allowedModes DROP DEFAULT;

ALTER TABLE webknossos.taskTypes
  ALTER COLUMN settings_allowedModes TYPE webknossos.TASKTYPE_MODES_old[]
  USING settings_allowedModes::text[]::webknossos.TASKTYPE_MODES_old[];

ALTER TABLE webknossos.taskTypes
  ALTER COLUMN settings_allowedModes SET DEFAULT '{orthogonal, flight, oblique}';

ALTER TABLE webknossos.taskTypes
  ALTER COLUMN settings_preferredMode TYPE webknossos.TASKTYPE_MODES_old
  USING settings_preferredMode::text::webknossos.TASKTYPE_MODES_old;

DROP TYPE webknossos.TASKTYPE_MODES;
ALTER TYPE webknossos.TASKTYPE_MODES_old RENAME TO TASKTYPE_MODES;

UPDATE webknossos.releaseInformation SET schemaVersion = 168;

COMMIT TRANSACTION;
