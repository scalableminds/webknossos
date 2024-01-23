START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 111, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.annotations_;

ALTER TABLE webknossos.annotations ADD COLUMN statistics JSONB;

UPDATE webknossos.annotations SET statistics = '{}'::jsonb;
UPDATE webknossos.annotations a SET statistics = (SELECT statistics FROM webknossos.annotation_layers al WHERE al._annotation = a._id AND typ = 'Skeleton');
ALTER TABLE webknossos.annotations ALTER COLUMN statistics SET NOT NULL;
ALTER TABLE webknossos.annotations ADD CONSTRAINT statisticsIsJsonObject CHECK(jsonb_typeof(statistics) = 'object');

ALTER TABLE webknossos.annotation_layers DROP COLUMN statistics;

CREATE VIEW webknossos.annotations_ as SELECT * FROM webknossos.annotations WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 110;

COMMIT TRANSACTION;
