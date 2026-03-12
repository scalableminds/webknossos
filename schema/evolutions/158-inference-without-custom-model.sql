START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 157 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.aiInferences_;

ALTER TABLE webknossos.aiInferences ALTER COLUMN _aiModel DROP NOT NULL;

CREATE VIEW webknossos.aiInferences_ as SELECT * FROM webknossos.aiInferences WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 158;

COMMIT TRANSACTION;
