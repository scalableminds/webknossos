START TRANSACTION;

ALTER TABLE webknossos.multiusers ADD isEmailVerified BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE webknossos.emailVerificationKeys(
                                               _id CHAR(24) PRIMARY KEY,
                                               key TEXT NOT NULL,
                                               email VARCHAR(512) NOT NULL,
                                               _multiUser CHAR(24) NOT NULL,
                                               validUntil TIMESTAMPTZ NOT NULL,
                                               isUsed BOOLEAN NOT NULL DEFAULT false
);

UPDATE webknossos.releaseInformation SET schemaVersion = 103;

COMMIT TRANSACTION;
