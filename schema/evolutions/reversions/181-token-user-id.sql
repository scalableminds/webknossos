START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 181 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

CREATE TYPE webknossos.USER_LOGININFO_PROVDERIDS AS ENUM ('credentials');

DROP VIEW webknossos.tokens_;

ALTER TABLE webknossos.tokens ADD COLUMN loginInfo_providerID webknossos.USER_LOGININFO_PROVDERIDS;
ALTER TABLE webknossos.tokens ADD COLUMN loginInfo_providerKey TEXT;

UPDATE webknossos.tokens SET loginInfo_providerID = 'credentials', loginInfo_providerKey = _user;

ALTER TABLE webknossos.tokens ALTER COLUMN loginInfo_providerID SET NOT NULL;
ALTER TABLE webknossos.tokens ALTER COLUMN loginInfo_providerKey SET NOT NULL;

DROP INDEX webknossos.tokens__user_tokentype_idx;
CREATE INDEX ON webknossos.tokens(loginInfo_providerID, loginInfo_providerKey, tokenType);

ALTER TABLE webknossos.tokens DROP COLUMN _user;

CREATE VIEW webknossos.tokens_ AS SELECT * FROM webknossos.tokens WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 180;

COMMIT TRANSACTION;
