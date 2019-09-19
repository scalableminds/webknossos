-- https://github.com/scalableminds/webknossos/pull/4286

START TRANSACTION;

DROP VIEW webknossos.dataStores_;

ALTER TABLE webknossos.dataStores ADD COLUMN publicUrl VARCHAR(512) UNIQUE;

CREATE VIEW webknossos.dataStores_ AS SELECT * FROM webknossos.dataStores WHERE NOT isDeleted;

UPDATE webknossos.dataStores SET publicUrl = url;

ALTER TABLE webknossos.dataStores ALTER COLUMN publicUrl SET NOT NULL;
ALTER TABLE webknossos.dataStores ADD CHECK (publicUrl ~* '^https?://[a-z0-9\.]+.*$');

UPDATE webknossos.releaseInformation SET schemaVersion = 46;

COMMIT TRANSACTION;
