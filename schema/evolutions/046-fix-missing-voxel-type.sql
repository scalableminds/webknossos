-- https://github.com/scalableminds/webknossos/pull/4303

-- fixes the line missing in evolution 038-more-voxel-types.sql – schema.sql actually includes this since then

-- note that it is very complex to reverse this (which is why we don't do it), compare also
-- https://www.postgresql.org/message-id/CANu8FiwwBxZZGX23%3DNa_7bc4DZ-yzd_poKhaoPmN3%2BSHG08MAg%40mail.gmail.com

--unfortunately, in postgresql, ALTER TYPE ... ADD cannot run inside a transaction block, so no transaction here

ALTER TYPE webknossos.DATASET_LAYER_ELEMENT_CLASS ADD VALUE 'uint64';

UPDATE webknossos.releaseInformation SET schemaVersion = 46;
