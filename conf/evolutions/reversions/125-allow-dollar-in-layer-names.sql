START TRANSACTION;

-- This reversion might take a while because it needs to search in all annotation layer names for '$' and replace it with ''
do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 125, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

UPDATE webknossos.annotation_layers SET name = regexp_replace(name, '\$', '', 'g') WHERE name ~* '\$';

ALTER TABLE webknossos.annotation_layers DROP CONSTRAINT IF EXISTS annotation_layers_name_check;
ALTER TABLE webknossos.annotation_layers ADD CONSTRAINT annotation_layers_name_check  CHECK (name ~* '^[A-Za-z0-9\-_\.]+$');

UPDATE webknossos.releaseInformation SET schemaVersion = 124;

COMMIT TRANSACTION;
