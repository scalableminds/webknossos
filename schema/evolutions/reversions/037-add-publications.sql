START TRANSACTION;

DROP VIEW webknossos.publications_;
DROP VIEW webknossos.dataSets_;

ALTER TABLE webknossos.dataSets DROP _publication;
ALTER TABLE webknossos.dataSets DROP details;

DROP TABLE webknossos.publications;

CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 36;

COMMIT TRANSACTION;
