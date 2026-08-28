START TRANSACTION;

DO $$ BEGIN IF (SELECT schemaVersion FROM webknossos.releaseInformation) <> 146 THEN RAISE EXCEPTION 'Previous schema version mismatch'; END IF; END; $$ LANGUAGE PLPGSQL;

CREATE TABLE webknossos.organization_plan_updates(
  _organization TEXT NOT NULL,
  description TEXT DEFAULT NULL,
  pricingPlan webknossos.PRICING_PLANS DEFAULT NULL,
  paidUntil TIMESTAMPTZ DEFAULT NULL,
  paidUntilChanged BOOLEAN NOT NULL, -- bool is necessary because set to null is distinct from did not change
  includedUsers INTEGER DEFAULT NULL,
  includedUsersChanged BOOLEAN NOT NULL, -- bool is necessary because set to null is distinct from did not change
  includedStorage BIGINT DEFAULT NULL,
  includedStorageChanged BOOLEAN NOT NULL, -- bool is necessary because set to null is distinct from did not change
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT validOrganizationId CHECK (_organization ~* '^[A-Za-z0-9\-_. ]+$')
);

ALTER TABLE webknossos.organization_plan_updates
  ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES webknossos.organizations(_id) ON DELETE CASCADE DEFERRABLE;

UPDATE webknossos.releaseInformation SET schemaVersion = 147;

COMMIT TRANSACTION;
