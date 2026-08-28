START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 180 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.tokens_;

ALTER TABLE webknossos.tokens ADD COLUMN _user TEXT;

-- loginInfo_providerKey already held the user id as a string (loginInfo_providerID was always 'credentials')
UPDATE webknossos.tokens SET _user = loginInfo_providerKey;

ALTER TABLE webknossos.tokens ADD CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.tokens ALTER COLUMN _user SET NOT NULL;

DROP INDEX webknossos.tokens_logininfo_providerid_logininfo_providerkey_tokentype_idx;
CREATE INDEX ON webknossos.tokens(_user, tokenType);

ALTER TABLE webknossos.tokens DROP COLUMN loginInfo_providerID;
ALTER TABLE webknossos.tokens DROP COLUMN loginInfo_providerKey;
CREATE VIEW webknossos.tokens_ AS SELECT * FROM webknossos.tokens WHERE NOT isDeleted;

DROP TYPE webknossos.USER_LOGININFO_PROVDERIDS;

UPDATE webknossos.releaseInformation SET schemaVersion = 181;

COMMIT TRANSACTION;
