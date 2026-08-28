START TRANSACTION;

DROP VIEW webknossos.annotations_;
DROP TRIGGER onUpdateAnnotationTrigger on webknossos.annotations;

ALTER TABLE webknossos.annotations ADD COLUMN isPublic BOOLEAN NOT NULL DEFAULT false;

UPDATE webknossos.annotations SET isPublic=true WHERE visibility='Public';

ALTER TABLE webknossos.annotations DROP COLUMN visibility;
DROP TYPE webknossos.ANNOTATION_VISIBILITY;

CREATE VIEW webknossos.annotations_ AS SELECT * FROM webknossos.annotations WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 48;

CREATE TRIGGER onUpdateAnnotationTrigger
AFTER UPDATE ON webknossos.annotations
FOR EACH ROW EXECUTE PROCEDURE webknossos.onUpdateAnnotation();

COMMIT TRANSACTION;
