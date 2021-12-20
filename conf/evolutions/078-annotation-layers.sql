begin transaction;

CREATE TYPE webknossos.ANNOTATION_LAYER_TYPE AS ENUM ('Skeleton', 'Volume');
CREATE TABLE webknossos.annotation_layers(
  _annotation CHAR(24) NOT NULL,
  tracingId CHAR(36) NOT NULL UNIQUE,
  typ webknossos.ANNOTATION_LAYER_TYPE NOT NULL,
  name VARCHAR(256),
  PRIMARY KEY (_annotation, tracingId)
);

insert into webknossos.annotation_layers (_annotation, tracingId, typ, name)
select _id, skeletonTracingId, 'Skeleton', NULL
from webknossos.annotations_
where skeletonTracingId is not null;

insert into webknossos.annotation_layers (_annotation, tracingId, typ, name)
select _id, volumeTracingId, 'Volume', NULL
from webknossos.annotations_
where volumeTracingId is not null;

DROP VIEW webknossos.annotations_;

ALTER TABLE webknossos.annotations DROP CONSTRAINT annotations_check1;
ALTER TABLE webknossos.annotations DROP COLUMN skeletonTracingId;
ALTER TABLE webknossos.annotations DROP COLUMN volumeTracingId;

CREATE VIEW webknossos.annotations_ AS SELECT * FROM webknossos.annotations WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 78;

commit;
