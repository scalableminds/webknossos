START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 186 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.dataStores_;

ALTER TABLE webknossos.dataStores ADD COLUMN isScratch BOOLEAN NOT NULL DEFAULT FALSE;

CREATE VIEW webknossos.dataStores_ AS SELECT * FROM webknossos.dataStores WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 185;

COMMIT TRANSACTION;
