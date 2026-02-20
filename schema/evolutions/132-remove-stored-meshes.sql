do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 131, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.meshes_;
DROP TABLE webknossos.meshes;

UPDATE webknossos.releaseInformation SET schemaVersion = 132;
