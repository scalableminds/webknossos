START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 185 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

CREATE TABLE webknossos.organization_storageWarnings(
  _organization TEXT NOT NULL,
  thresholdPercent INT NOT NULL, -- the storage usage threshold the warning was sent for; removed again once usage drops clearly below it
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (_organization, thresholdPercent),
  CONSTRAINT validOrganizationId CHECK (_organization ~* '^[A-Za-z0-9\-_. ]+$')
);

ALTER TABLE webknossos.organization_storageWarnings
  ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES webknossos.organizations(_id) ON DELETE CASCADE DEFERRABLE;

UPDATE webknossos.releaseInformation SET schemaVersion = 186;

COMMIT TRANSACTION;
