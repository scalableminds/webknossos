-- Note that this evolution introduces constraints which may not be met by existing data. See migration guide for manual steps

START TRANSACTION;

CREATE TABLE webknossos.annotation_private_links(
  _id CHAR(24) PRIMARY KEY DEFAULT '',
  _annotation CHAR(24) NOT NULL,
  value              Text        NOT NULL,
  expirationDateTime TIMESTAMPTZ NOT NULL,
  isDeleted          BOOLEAN     NOT NULL DEFAULT false
) ADD CONSTRAINT annotation_ref FOREIGN KEY(_annotation) REFERENCES webknossos.annotations(_id) DEFERRABLE;

CREATE VIEW webknossos.annotation_private_links_ as
SELECT *
FROM webknossos.annotation_private_links
WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation
SET schemaVersion = 84;

COMMIT TRANSACTION;
