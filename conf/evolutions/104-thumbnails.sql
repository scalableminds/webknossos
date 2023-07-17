START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 103, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

CREATE TABLE webknossos.dataSet_thumbnails(
  _dataSet CHAR(24) NOT NULL,
  dataLayerName VARCHAR(256),
  width INT NOT NULL,
  height INT NOT NULL,
  mappingName VARCHAR(256) NOT NULL, -- emptystring means no mapping
  image BYTEA NOT NULL,
  mimetype VARCHAR(256),
  mag webknossos.VECTOR3 NOT NULL,
  mag1BoundingBox webknossos.BOUNDING_BOX NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (_dataSet, dataLayerName, width, height, mappingName)
);

UPDATE webknossos.releaseInformation SET schemaVersion = 104;

COMMIT TRANSACTION;
