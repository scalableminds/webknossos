START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 106, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.folders_;

-- set cannot be undone (we don’t want to turn all underscores into slashes)

ALTER TABLE webknossos.folders DROP CONSTRAINT folders_name_check;

CREATE VIEW webknossos.folders_ as SELECT * FROM webknossos.folders WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 105;

COMMIT TRANSACTION;
