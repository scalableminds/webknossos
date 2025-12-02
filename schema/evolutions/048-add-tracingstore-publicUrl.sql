-- https://github.com/scalableminds/webknossos/pull/4286

START TRANSACTION;

DROP VIEW webknossos.tracingStores_;

ALTER TABLE webknossos.tracingStores ADD COLUMN publicUrl VARCHAR(512) UNIQUE;

CREATE VIEW webknossos.tracingStores_ AS SELECT * FROM webknossos.tracingStores WHERE NOT isDeleted;

UPDATE webknossos.tracingStores SET publicUrl = url;

ALTER TABLE webknossos.tracingStores ALTER COLUMN publicUrl SET NOT NULL;
ALTER TABLE webknossos.tracingStores ADD CHECK (publicUrl ~* '^https?://[a-z0-9\.]+.*$');

UPDATE webknossos.releaseInformation SET schemaVersion = 48;

COMMIT TRANSACTION;
