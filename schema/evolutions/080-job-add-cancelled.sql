-- unfortunately, ALTER TYPE ... ADD cannot run inside a transaction block. It can also not be reverted

ALTER TYPE webknossos.JOB_STATE ADD VALUE 'CANCELLED';

UPDATE webknossos.releaseInformation SET schemaVersion = 80;
