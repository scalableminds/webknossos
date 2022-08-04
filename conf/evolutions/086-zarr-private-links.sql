-- Note that this evolution introduces constraints which may not be met by existing data. See migration guide for manual steps

START TRANSACTION;

CREATE TABLE webknossos.annotation_private_links
(
  _id CHAR(24) PRIMARY KEY DEFAULT '',
  _annotation CHAR(24) NOT NULL,
  accessToken              Text        NOT NULL UNIQUE,
  expirationDateTime TIMESTAMPTZ ,
  isDeleted          BOOLEAN     NOT NULL DEFAULT false
);

CREATE INDEX ON webknossos.annotation_private_links(accessToken);

ALTER TABLE webknossos.annotation_private_links
  ADD CONSTRAINT annotation_ref FOREIGN KEY (_annotation) REFERENCES webknossos.annotations (_id) DEFERRABLE;

CREATE VIEW webknossos.annotation_private_links_ as
SELECT *
FROM webknossos.annotation_private_links
WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation
SET schemaVersion = 86;

COMMIT TRANSACTION;
