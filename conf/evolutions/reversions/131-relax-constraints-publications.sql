START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 131, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.publications_;
ALTER TABLE webknossos.publications  ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
CREATE VIEW webknossos.publications_ AS SELECT * FROM webknossos.publications WHERE NOT isDeleted;

DROP VIEW webknossos.annotations_;
ALTER TABLE webknossos.annotations ADD CONSTRAINT _publication_objectId CHECK (_publication ~ '^[0-9a-f]{24}$');
CREATE VIEW webknossos.annotations_ AS SELECT * FROM webknossos.annotations WHERE NOT isDeleted;

DROP VIEW webknossos.datasets_;
ALTER TABLE webknossos.datasets ADD CONSTRAINT _publication_objectId CHECK (_publication ~ '^[0-9a-f]{24}$');
CREATE VIEW webknossos.datasets_ AS SELECT * FROM webknossos.datasets WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 130;

COMMIT TRANSACTION;
