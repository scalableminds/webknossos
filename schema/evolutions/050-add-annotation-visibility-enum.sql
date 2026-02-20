-- https://github.com/scalableminds/webknossos/pull/4315

START TRANSACTION;

DROP VIEW webknossos.annotations_;
DROP TRIGGER onUpdateAnnotationTrigger on webknossos.annotations;

CREATE TYPE webknossos.ANNOTATION_VISIBILITY AS ENUM ('Private', 'Internal', 'Public');

ALTER TABLE webknossos.annotations ADD COLUMN visibility webknossos.ANNOTATION_VISIBILITY NOT NULL DEFAULT 'Internal';

UPDATE webknossos.annotations SET visibility = 'Public' WHERE isPublic;

ALTER TABLE webknossos.annotations DROP COLUMN isPublic;

CREATE VIEW webknossos.annotations_ AS SELECT * FROM webknossos.annotations WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 50;

CREATE TRIGGER onUpdateAnnotationTrigger
AFTER UPDATE ON webknossos.annotations
FOR EACH ROW EXECUTE PROCEDURE webknossos.onUpdateAnnotation();

COMMIT TRANSACTION;
