-- WARNING: This reversion is lossy for all annotations with named annotation layers or with more than one volume layer.

begin transaction;

DROP VIEW webknossos.annotations_;

ALTER TABLE webknossos.annotations ADD COLUMN skeletonTracingId CHAR(36) UNIQUE;
ALTER TABLE webknossos.annotations ADD COLUMN volumeTracingId CHAR(36) UNIQUE;


UPDATE webknossos.annotations
SET skeletonTracingId = tracingId
FROM webknossos.annotation_layers
WHERE
  webknossos.annotation_layers._annotation = webknossos.annotations._id AND
  webknossos.annotation_layers.typ = 'Skeleton';

UPDATE webknossos.annotations
SET volumeTracingId = tracingId
FROM webknossos.annotation_layers
WHERE
  webknossos.annotation_layers._annotation = webknossos.annotations._id AND
  webknossos.annotation_layers.typ = 'Volume';


ALTER TABLE webknossos.annotations ADD CONSTRAINT annotations_check1 CHECK (COALESCE(skeletonTracingId,volumeTracingId) IS NOT NULL);

CREATE VIEW webknossos.annotations_ AS SELECT * FROM webknossos.annotations WHERE NOT isDeleted;


DROP TABLE webknossos.annotation_layers;
DROP TYPE webknossos.ANNOTATION_LAYER_TYPE;

UPDATE webknossos.releaseInformation SET schemaVersion = 76;

commit;
