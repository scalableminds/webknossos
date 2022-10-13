START TRANSACTION;

ALTER TABLE webknossos.annotation_layers
ALTER COLUMN name DROP NOT NULL;

ALTER TABLE webknossos.annotation_layers
DROP CONSTRAINT annotation_layers_name__annotation_key;

ALTER TABLE webknossos.annotation_layers
DROP CONSTRAINT annotation_layers_name_check;

UPDATE webknossos.releaseInformation SET schemaVersion = 82;

COMMIT TRANSACTION;
