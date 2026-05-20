START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 162 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

-- Remove pretrained models inserted by application startup
DELETE FROM webknossos.aiModels WHERE isPretrained;

-- Clear any rows using the new enum values before removing them
UPDATE webknossos.aiModels SET category = NULL WHERE category IN ('em_generic', 'em_somata', 'em_mitochondria');

DROP VIEW webknossos.aiModels_;

ALTER TABLE webknossos.aiModels DROP COLUMN isSuperUserOnly;
ALTER TABLE webknossos.aiModels DROP COLUMN isPretrained;

-- Recreate the enum type without the three new values by temporarily casting to text
ALTER TABLE webknossos.aiModels ALTER COLUMN category TYPE VARCHAR(255);
DROP TYPE webknossos.AI_MODEL_CATEGORY;
CREATE TYPE webknossos.AI_MODEL_CATEGORY AS ENUM ('em_neurons', 'em_nuclei', 'em_synapses', 'em_neuron_types', 'em_cell_organelles');
ALTER TABLE webknossos.aiModels ALTER COLUMN category TYPE webknossos.AI_MODEL_CATEGORY USING category::webknossos.AI_MODEL_CATEGORY;

CREATE VIEW webknossos.aiModels_ AS SELECT * FROM webknossos.aiModels WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 161;

COMMIT TRANSACTION;
