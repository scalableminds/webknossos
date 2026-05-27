START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 164 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP TABLE webknossos.user_keyboardShortcutsConfigs;

UPDATE webknossos.releaseInformation SET schemaVersion = 163;

COMMIT TRANSACTION;
