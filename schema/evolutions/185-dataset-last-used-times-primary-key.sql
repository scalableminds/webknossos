START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 184 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

-- Remove duplicates, keeping the most recent lastUsedTime per dataset and user
DELETE FROM webknossos.dataset_lastUsedTimes a
USING webknossos.dataset_lastUsedTimes b
WHERE a._dataset = b._dataset
  AND a._user = b._user
  AND (a.lastUsedTime < b.lastUsedTime OR (a.lastUsedTime = b.lastUsedTime AND a.ctid < b.ctid));

ALTER TABLE webknossos.dataset_lastUsedTimes ADD PRIMARY KEY (_dataset, _user);

UPDATE webknossos.releaseInformation SET schemaVersion = 185;

COMMIT TRANSACTION;
