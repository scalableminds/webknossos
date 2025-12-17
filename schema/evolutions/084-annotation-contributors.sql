START TRANSACTION;

DROP VIEW webknossos.annotations_;
ALTER TABLE webknossos.annotations ADD COLUMN othersMayEdit BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE webknossos.annotation_contributors(
  _annotation CHAR(24) NOT NULL,
  _user CHAR(24) NOT NULL,
  PRIMARY KEY (_annotation, _user)
);

ALTER TABLE webknossos.annotation_contributors
    ADD CONSTRAINT annotation_ref FOREIGN KEY(_annotation) REFERENCES webknossos.annotations(_id) ON DELETE CASCADE DEFERRABLE,
    ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES webknossos.users(_id) ON DELETE CASCADE DEFERRABLE;

CREATE VIEW webknossos.annotations_ AS SELECT * FROM webknossos.annotations WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 84;

COMMIT TRANSACTION;
