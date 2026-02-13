START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 153 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.annotations_;

ALTER TABLE webknossos.annotations ADD COLUMN othersMayEdit BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE webknossos.annotations SET othersMayEdit = TRUE WHERE collaborationMode = 'Exclusive' OR collaborationMode = 'Concurrent';

ALTER TABLE webknossos.annotations DROP COLUMN collaborationMode;

CREATE VIEW webknossos.annotations_ AS SELECT * FROM webknossos.annotations WHERE NOT isDeleted;

DROP TYPE webknossos.ANNOTATION_COLLABORATION_MODE;


DROP TABLE webknossos.annotation_reserved_ids;
DROP TYPE webknossos.ANNOTATION_ID_DOMAIN;

UPDATE webknossos.releaseInformation SET schemaVersion = 152;

COMMIT TRANSACTION;
