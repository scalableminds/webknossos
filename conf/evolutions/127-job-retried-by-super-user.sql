START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 126, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.jobs_;

ALTER TABLE webknossos.jobs ADD column retriedBySuperUser BOOLEAN NOT NULL DEFAULT false;
UPDATE webknossos.releaseInformation SET schemaVersion = 127;

CREATE VIEW webknossos.jobs_ AS SELECT * FROM webknossos.jobs WHERE NOT isDeleted;

COMMIT TRANSACTION;
