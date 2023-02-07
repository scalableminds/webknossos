START TRANSACTION;

CREATE TABLE webknossos.annotation_mutexes(
  _annotation CHAR(24) PRIMARY KEY,
  _user CHAR(24) NOT NULL,
  expiry TIMESTAMP NOT NULL
);

ALTER TABLE webknossos.annotation_mutexes
    ADD CONSTRAINT annotation_ref FOREIGN KEY(_annotation) REFERENCES webknossos.annotations(_id) ON DELETE CASCADE DEFERRABLE,
    ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES webknossos.users(_id) ON DELETE CASCADE DEFERRABLE;

UPDATE webknossos.releaseInformation
SET schemaVersion = 100;

COMMIT TRANSACTION;
