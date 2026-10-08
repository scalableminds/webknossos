START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 186 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.jobs_;

ALTER TABLE webknossos.jobs DROP COLUMN _alignmentProject;

CREATE VIEW webknossos.jobs_ AS SELECT * FROM webknossos.jobs WHERE NOT isDeleted;

DROP VIEW webknossos.alignmentProjects_;

DROP TABLE webknossos.alignmentProjects;

DROP TYPE webknossos.ALIGNMENT_PROJECT_STATUS;

UPDATE webknossos.releaseInformation SET schemaVersion = 185;

COMMIT TRANSACTION;
