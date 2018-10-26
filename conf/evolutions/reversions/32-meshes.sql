START TRANSACTION;

DROP VIEW webknossos.meshes_;

DROP TABLE webknossos.meshes;

UPDATE webknossos.releaseInformation SET schemaVersion = 31;

COMMIT TRANSACTION;
