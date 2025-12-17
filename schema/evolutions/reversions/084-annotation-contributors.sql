START TRANSACTION;

DROP VIEW webknossos.annotations_;

ALTER TABLE webknossos.annotations DROP COLUMN othersMayEdit;

DROP TABLE webknossos.annotation_contributors;

CREATE VIEW webknossos.annotations_ AS SELECT * FROM webknossos.annotations WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 83;

COMMIT TRANSACTION;
