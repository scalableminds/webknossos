START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 141, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

ALTER TABLE webknossos.annotation_layers DROP CONSTRAINT annotation_layers_name__annotation_key;
ALTER TABLE webknossos.annotation_layers ADD CONSTRAINT annotation_layers_name__annotation_key UNIQUE (name, _annotation);

UPDATE webknossos.releaseInformation SET schemaVersion = 140;

COMMIT TRANSACTION;
