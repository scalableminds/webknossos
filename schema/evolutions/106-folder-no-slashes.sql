START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 105, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.folders_;

UPDATE webknossos.folders SET name = REPLACE(name, '/', '_') WHERE name ~ '/';

ALTER TABLE webknossos.folders ADD CONSTRAINT folders_name_check CHECK (name !~ '/');

CREATE VIEW webknossos.folders_ as SELECT * FROM webknossos.folders WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 106;

COMMIT TRANSACTION;
