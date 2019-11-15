-- https://github.com/scalableminds/webknossos/pull/X

START TRANSACTION;

DROP VIEW webknossos.annotations_;

CREATE TYPE webknossos.ANNOTATION_VISIBILITY AS ENUM ('Private', 'Internal', 'Public');

ALTER TABLE webknossos.annotations ADD COLUMN visibility webknossos.ANNOTATION_VISIBILITY NOT NULL DEFAULT 'Internal' ;

UPDATE webknossos.annotations SET visibility = CASE WHEN (isPublic) THEN 'Public' END;

ALTER TABLE webknossos.annotations DROP COLUMN isPublic;

CREATE VIEW webknossos.annotations_ AS SELECT * FROM webknossos.annotations WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 50;

COMMIT TRANSACTION;
