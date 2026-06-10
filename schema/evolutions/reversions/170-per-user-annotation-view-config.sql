START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 170 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.annotations_;

-- Readd old viewConfiguration column
ALTER TABLE webknossos.annotations ADD COLUMN viewConfiguration JSONB;

-- migrate owner view config to annotation table
UPDATE webknossos.annotations AS a
SET viewConfiguration = c.viewConfiguration
FROM webknossos.user_annotationViewConfigurations AS c
WHERE a._id = c._annotation AND a._user = c._user;

DROP TABLE webknossos.user_annotationViewConfigurations;

CREATE VIEW webknossos.annotations_ AS SELECT * FROM webknossos.annotations WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 169;

COMMIT TRANSACTION;
