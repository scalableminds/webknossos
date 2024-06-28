START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 117, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.folders_;

ALTER TABLE webknossos.folders ADD details JSONB DEFAULT '[]';
ALTER TABLE webknossos.folders ADD CONSTRAINT detailsIsJsonObject CHECK(jsonb_typeof(details) = 'array');

CREATE VIEW webknossos.folders_ as SELECT * FROM webknossos.folders WHERE NOT isDeleted;
UPDATE webknossos.releaseInformation SET schemaVersion = 118;

COMMIT TRANSACTION;
