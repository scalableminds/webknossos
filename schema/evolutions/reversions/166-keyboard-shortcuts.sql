START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 166 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP TABLE webknossos.multiUser_keyboardShortcutsConfigs;

UPDATE webknossos.releaseInformation SET schemaVersion = 165;

COMMIT TRANSACTION;
