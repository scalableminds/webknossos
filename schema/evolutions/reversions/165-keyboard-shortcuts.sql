START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 165 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP TABLE webknossos.multiUser_keyboardShortcutsConfigs;

UPDATE webknossos.releaseInformation SET schemaVersion = 164;

COMMIT TRANSACTION;
