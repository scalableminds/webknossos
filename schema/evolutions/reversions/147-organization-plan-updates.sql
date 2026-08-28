START TRANSACTION;

DO $$ BEGIN IF (SELECT schemaVersion FROM webknossos.releaseInformation) <> 147 THEN RAISE EXCEPTION 'Previous schema version mismatch'; END IF; END; $$ language plpgsql;

DROP TABLE webknossos.organization_plan_updates;

UPDATE webknossos.releaseInformation SET schemaVersion = 146;

COMMIT TRANSACTION;
