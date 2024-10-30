
-- no transaction here, since ALTER TYPE ... ADD cannot run inside a transaction block

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 122, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

ALTER TYPE webknossos.AI_MODEL_CATEGORY ADD VALUE 'em_synapses';
ALTER TYPE webknossos.AI_MODEL_CATEGORY ADD VALUE 'em_neuron_types';
ALTER TYPE webknossos.AI_MODEL_CATEGORY ADD VALUE 'em_cell_organelles';

UPDATE webknossos.releaseInformation SET schemaVersion = 123;

