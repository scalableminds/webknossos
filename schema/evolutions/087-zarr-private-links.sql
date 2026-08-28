START TRANSACTION;

CREATE TABLE webknossos.annotation_privateLinks
(
  _id CHAR(24) PRIMARY KEY DEFAULT '',
  _annotation CHAR(24) NOT NULL,
  accessToken Text NOT NULL UNIQUE,
  expirationDateTime TIMESTAMPTZ ,
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX ON webknossos.annotation_privateLinks(accessToken);

ALTER TABLE webknossos.annotation_privateLinks
  ADD CONSTRAINT annotation_ref FOREIGN KEY (_annotation) REFERENCES webknossos.annotations (_id) DEFERRABLE;

CREATE VIEW webknossos.annotation_privateLinks_ as
SELECT *
FROM webknossos.annotation_privateLinks
WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation
SET schemaVersion = 87;

COMMIT TRANSACTION;
