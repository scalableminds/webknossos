START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 116, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.datasets_;

CREATE TYPE webknossos.LENGTH_UNIT AS ENUM ('yoctometer', 'zeptometer', 'attometer', 'femtometer', 'picometer', 'nanometer', 'micrometer', 'millimeter', 'centimeter', 'decimeter', 'meter', 'hectometer', 'kilometer', 'megameter', 'gigameter', 'terameter', 'petameter', 'exameter', 'zettameter', 'yottameter', 'angstrom', 'inch', 'foot', 'yard', 'mile', 'parsec');

ALTER TABLE webknossos.datasets RENAME COLUMN scale TO voxelSizeFactor;
ALTER TABLE webknossos.datasets ADD COLUMN voxelSizeUnit webknossos.LENGTH_UNIT;

CREATE VIEW webknossos.datasets_ AS SELECT * FROM webknossos.datasets WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 117;

COMMIT TRANSACTION;
