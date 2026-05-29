START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 164 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

CREATE TABLE webknossos.multiUser_keyboardShortcutsConfigs(
  _multiUser TEXT CONSTRAINT _multiUser_objectId CHECK (_multiUser ~ '^[0-9a-f]{24}$') NOT NULL,
  shortcutsConfig JSONB NOT NULL DEFAULT '{}'::json,
  PRIMARY KEY (_multiUser),
  CONSTRAINT shortcutsConfigIsJsonObject CHECK(jsonb_typeof(shortcutsConfig) = 'object')
);

ALTER TABLE webknossos.multiUser_keyboardShortcutsConfigs
  ADD CONSTRAINT multiUser_ref FOREIGN KEY(_multiUser) REFERENCES webknossos.multiUsers(_id) ON DELETE CASCADE DEFERRABLE;

UPDATE webknossos.releaseInformation SET schemaVersion = 165;

COMMIT TRANSACTION;
