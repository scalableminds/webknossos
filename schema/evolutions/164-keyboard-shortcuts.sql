START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 163 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

CREATE TABLE webknossos.user_keyboardShortcutsConfigs(
  _user TEXT CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$') NOT NULL,
  shortcutsConfig JSONB NOT NULL DEFAULT '{}'::json,
  PRIMARY KEY (_user),
  CONSTRAINT shortcutsConfigIsJsonObject CHECK(jsonb_typeof(shortcutsConfig) = 'object')
);

ALTER TABLE webknossos.user_keyboardShortcutsConfigs
  ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES webknossos.users(_id) ON DELETE CASCADE DEFERRABLE;

UPDATE webknossos.releaseInformation SET schemaVersion = 164;

COMMIT TRANSACTION;
