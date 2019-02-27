-- https://github.com/scalableminds/webknossos/pull/3686

-- note that it is very complex to reverse this (which is why we don't do it), compare also
-- https://www.postgresql.org/message-id/CANu8FiwwBxZZGX23%3DNa_7bc4DZ-yzd_poKhaoPmN3%2BSHG08MAg%40mail.gmail.com

--unfortunately, in postgresql, ALTER TYPE ... ADD cannot run inside a transaction block, so no transaction here

ALTER TYPE webknossos.DATASET_LAYER_ELEMENT_CLASS ADD VALUE 'float';
ALTER TYPE webknossos.DATASET_LAYER_ELEMENT_CLASS ADD VALUE 'double';
ALTER TYPE webknossos.DATASET_LAYER_ELEMENT_CLASS ADD VALUE 'int8';
ALTER TYPE webknossos.DATASET_LAYER_ELEMENT_CLASS ADD VALUE 'int16';
ALTER TYPE webknossos.DATASET_LAYER_ELEMENT_CLASS ADD VALUE 'int32';
ALTER TYPE webknossos.DATASET_LAYER_ELEMENT_CLASS ADD VALUE 'int64';

UPDATE webknossos.releaseInformation SET schemaVersion = 38;

