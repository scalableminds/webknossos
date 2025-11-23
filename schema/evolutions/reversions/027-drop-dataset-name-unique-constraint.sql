START TRANSACTION;

DROP VIEW webknossos.dataSets_;
ALTER TABLE webknossos.dataSets ADD CONSTRAINT UNIQUE(name);
CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 26;

COMMIT TRANSACTION;
