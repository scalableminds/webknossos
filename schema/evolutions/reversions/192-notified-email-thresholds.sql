START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 192 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

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

INSERT INTO webknossos.organization_planExpiryReminders(_organization, paidUntil, leadTimeDays, created)
SELECT s._organization, o.paidUntil, s.threshold, s.created
FROM webknossos.organization_notifiedEmailThresholds s
JOIN webknossos.organizations o ON o._id = s._organization
WHERE s.emailType = 'PlanExpiry' AND o.paidUntil IS NOT NULL;

DROP TABLE webknossos.organization_notifiedEmailThresholds;
DROP TYPE webknossos.EMAIL_THRESHOLD_TYPE;

UPDATE webknossos.releaseInformation SET schemaVersion = 191;

COMMIT TRANSACTION;
