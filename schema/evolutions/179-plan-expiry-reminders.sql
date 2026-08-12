START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 178 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

CREATE TABLE webknossos.organization_planExpiryReminders(
  _organization TEXT NOT NULL,
  paidUntil TIMESTAMPTZ NOT NULL, -- the expiry date the reminder was sent for, so that extending the plan re-arms the reminders
  leadTimeDays INT NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (_organization, paidUntil, leadTimeDays),
  CONSTRAINT validOrganizationId CHECK (_organization ~* '^[A-Za-z0-9\-_. ]+$')
);

ALTER TABLE webknossos.organization_planExpiryReminders
  ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES webknossos.organizations(_id) ON DELETE CASCADE DEFERRABLE;

UPDATE webknossos.releaseInformation SET schemaVersion = 179;

COMMIT TRANSACTION;
