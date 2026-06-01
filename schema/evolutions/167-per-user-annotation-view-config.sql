START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 166 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

CREATE TABLE webknossos.user_annotationLayerConfigurations(
  _user TEXT CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$') NOT NULL,
  _annotation TEXT CONSTRAINT _annotation_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$') NOT NULL,
  viewConfiguration JSONB NOT NULL,
  PRIMARY KEY (_user, _annotation),
  CONSTRAINT viewConfigurationIsJsonObject CHECK(jsonb_typeof(viewConfiguration) = 'object')
);

INSERT INTO webknossos.user_annotationLayerConfigurations(_user, _annotation, viewConfiguration)
  SELECT _id, _user, viewConfiguration FROM webknossos.annotations;

-- TODO: Also merge datasetViewConfig (webknossos.user_datasetConfigurations) and layer config webknossos.user_datasetLayerConfigurations into this

ALTER TABLE webknossos.annotations DROP COLUMN viewConfiguration;

UPDATE webknossos.releaseInformation SET schemaVersion = 167;

COMMIT TRANSACTION;
