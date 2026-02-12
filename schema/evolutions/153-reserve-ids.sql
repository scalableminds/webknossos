START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 152 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

CREATE TYPE webknossos.ANNOTATION_COLLABORATION_MODE AS ENUM('OwnerOnly', 'Exclusive', 'Concurrent');

DROP VIEW webknossos.annotations_;

ALTER TABLE webknossos.annotations ADD COLUMN collaborationMode webknossos.ANNOTATION_COLLABORATION_MODE NOT NULL DEFAULT 'OwnerOnly';

UPDATE webknossos.annotations SET collaborationMode = 'Exclusive' WHERE othersMayEdit;

ALTER TABLE webknossos.annotations DROP COLUMN othersMayEdit;

CREATE VIEW webknossos.annotations_ AS SELECT * FROM webknossos.annotations WHERE NOT isDeleted;

CREATE TYPE webknossos.ANNOTATION_ID_DOMAIN AS ENUM ('Segment', 'SegmentGroup', 'Tree', 'Node', 'TreeGroup', 'BoundingBox');
CREATE TABLE webknossos.annotation_reserved_ids(
  _annotation TEXT NOT NULL  CONSTRAINT _annotation_objectId CHECK (_annotation ~ '^[0-9a-f]{24}$'),
  tracingId TEXT NOT NULL,
  domain webknossos.ANNOTATION_ID_DOMAIN NOT NULL,
  _user TEXT NOT NULL CONSTRAINT _user_objectId CHECK (_annotation ~ '^[0-9a-f]{24}$'),
  id BIGINT NOT NULL
);

ALTER TABLE webknossos.annotation_reserved_ids
    ADD CONSTRAINT annotation_ref FOREIGN KEY(_annotation) REFERENCES webknossos.annotations(_id) ON DELETE CASCADE DEFERRABLE,
    ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES webknossos.users(_id) ON DELETE CASCADE DEFERRABLE;

UPDATE webknossos.releaseInformation SET schemaVersion = 153;

COMMIT TRANSACTION;
