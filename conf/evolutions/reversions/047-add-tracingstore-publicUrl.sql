START TRANSACTION;

DROP VIEW webknossos.tracingStores_;

ALTER TABLE webknossos.tracingStores DROP publicUrl;

CREATE VIEW webknossos.tracingStores_ AS SELECT * FROM webknossos.tracingStores WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 46;

COMMIT TRANSACTION;
