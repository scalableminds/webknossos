START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 168 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.annotations_;

CREATE TABLE webknossos.user_annotationViewConfigurations(
  _user TEXT CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$') NOT NULL,
  _annotation TEXT CONSTRAINT _annotation_objectId CHECK (_annotation ~ '^[0-9a-f]{24}$') NOT NULL,
  viewConfiguration JSONB NOT NULL,
  PRIMARY KEY (_user, _annotation),
  CONSTRAINT viewConfigurationIsJsonObject CHECK(jsonb_typeof(viewConfiguration) = 'object')
);

ALTER TABLE webknossos.user_annotationViewConfigurations
    ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES webknossos.users(_id) ON DELETE CASCADE DEFERRABLE,
    ADD CONSTRAINT annotation_ref FOREIGN KEY(_annotation) REFERENCES webknossos.annotations(_id) ON DELETE CASCADE DEFERRABLE;

INSERT INTO webknossos.user_annotationViewConfigurations(_user, _annotation, viewConfiguration)
  SELECT _user, _id, viewConfiguration FROM webknossos.annotations WHERE viewConfiguration IS NOT NULL;

ALTER TABLE webknossos.annotations DROP COLUMN viewConfiguration;

CREATE VIEW webknossos.annotations_ AS SELECT * FROM webknossos.annotations WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 169;

COMMIT TRANSACTION;
