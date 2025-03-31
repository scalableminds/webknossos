START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 130, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

-- We have found that publications contains invalid objectIds. We will relax the constraint to allow for these invalid objectIds.

DROP VIEW webknossos.publications_;
ALTER TABLE webknossos.publications DROP CONSTRAINT IF EXISTS _id_objectId;
CREATE VIEW webknossos.publications_ AS SELECT * FROM webknossos.publications WHERE NOT isDeleted;

DROP VIEW webknossos.annotations_;
ALTER TABLE webknossos.annotations DROP CONSTRAINT IF EXISTS _publication_objectId;
CREATE VIEW webknossos.annotations_ AS SELECT * FROM webknossos.annotations WHERE NOT isDeleted;

DROP VIEW webknossos.datasets_;
ALTER TABLE webknossos.datasets DROP CONSTRAINT IF EXISTS _publication_objectId;
CREATE VIEW webknossos.datasets_ AS SELECT * FROM webknossos.datasets WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 131;

COMMIT TRANSACTION;
