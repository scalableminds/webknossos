START TRANSACTION;

DROP VIEW webknossos.dataSets_;
ALTER TABLE webknossos.dataSets DROP inboxSourceHash;

CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 43;

COMMIT TRANSACTION;
