START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 110, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.annotations_;

ALTER TABLE webknossos.annotation_layers ADD COLUMN statistics JSONB;

UPDATE webknossos.annotation_layers SET statistics = '{}'::jsonb;
UPDATE webknossos.annotation_layers al SET statistics = (SELECT statistics FROM webknossos.annotations a WHERE al._annotation = a._id) WHERE typ = 'Skeleton';
ALTER TABLE webknossos.annotation_layers ALTER COLUMN statistics SET NOT NULL;
ALTER TABLE webknossos.annotation_layers ADD CONSTRAINT statisticsIsJsonObject CHECK(jsonb_typeof(statistics) = 'object');

ALTER TABLE webknossos.annotations DROP COLUMN statistics;


CREATE VIEW webknossos.annotations_ as SELECT * FROM webknossos.annotations WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 111;

COMMIT TRANSACTION;
