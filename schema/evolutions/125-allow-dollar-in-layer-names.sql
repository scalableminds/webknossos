START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 124, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;


ALTER TABLE webknossos.annotation_layers DROP CONSTRAINT IF EXISTS annotation_layers_name_check;
ALTER TABLE webknossos.annotation_layers ADD CONSTRAINT annotation_layers_name_check  CHECK (name ~* '^[A-Za-z0-9\-_\.\$]+$');

UPDATE webknossos.releaseInformation SET schemaVersion = 125;

COMMIT TRANSACTION;
