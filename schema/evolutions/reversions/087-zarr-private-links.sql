START TRANSACTION;

DROP VIEW webknossos.annotation_privateLinks_;
DROP TABLE webknossos.annotation_privateLinks;

UPDATE webknossos.releaseInformation SET schemaVersion = 86;

COMMIT TRANSACTION;
