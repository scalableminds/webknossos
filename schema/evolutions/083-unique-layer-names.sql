-- Note that this evolution introduces constraints which may not be met by existing data. See migration guide for manual steps

START TRANSACTION;

ALTER TABLE webknossos.annotation_layers
ALTER COLUMN name SET NOT NULL;

ALTER TABLE webknossos.annotation_layers
ADD CONSTRAINT annotation_layers_name__annotation_key UNIQUE(name, _annotation);

ALTER TABLE webknossos.annotation_layers
ADD CONSTRAINT annotation_layers_name_check CHECK (name ~* '^[A-Za-z0-9\-_\.]+$');

UPDATE webknossos.releaseInformation SET schemaVersion = 83;

COMMIT TRANSACTION;
