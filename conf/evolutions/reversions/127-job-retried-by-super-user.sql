START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 127, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.jobs_;

ALTER TABLE webknossos.jobs DROP column retriedBySuperUser;
UPDATE webknossos.releaseInformation SET schemaVersion = 126;

CREATE VIEW webknossos.jobs_ AS SELECT * FROM webknossos.jobs WHERE NOT isDeleted;

COMMIT TRANSACTION;
