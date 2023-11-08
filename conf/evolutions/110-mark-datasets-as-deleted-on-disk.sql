START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 109, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

ALTER TABLE webknossos.datasets ADD COLUMN
  isRemovedOnDisk boolean NOT NULL DEFAULT false;
UPDATE webknossos.releaseInformation SET schemaVersion = 110;

COMMIT TRANSACTION;
