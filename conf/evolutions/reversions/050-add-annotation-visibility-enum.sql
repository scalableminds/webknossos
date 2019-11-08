START TRANSACTION;

DROP VIEW webknossos.annotations_;

DROP TYPE webknossos.ANNOTATION_VISIBILITY;

ALTER TABLE webknossos.annotations ADD COLUMN isPublic BOOLEAN NOT NULL DEFAULT false;

UPDATE webknossos.annotations SET isPublic = CASE WHEN (visibility = 'Public') THEN true ELSE false END;

ALTER TABLE webknossos.annotations DROP COLUMN visibility;

CREATE VIEW webknossos.annotations_ AS SELECT * FROM webknossos.annotations WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 48;

COMMIT TRANSACTION;
