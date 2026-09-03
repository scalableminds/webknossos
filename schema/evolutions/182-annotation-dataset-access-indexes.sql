START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 181 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

CREATE INDEX ON webknossos.annotations(_dataset);
CREATE INDEX ON webknossos.annotation_contributors(_user);

UPDATE webknossos.releaseInformation SET schemaVersion = 182;

COMMIT TRANSACTION;
