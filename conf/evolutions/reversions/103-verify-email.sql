START TRANSACTION;

ALTER TABLE webknossos.multiusers
  DROP COLUMN isEmailVerified;

DROP TABLE webknossos.emailVerificationKeys;

COMMIT TRANSACTION;
