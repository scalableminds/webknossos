START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 191 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

CREATE TYPE webknossos.EMAIL_THRESHOLD_TYPE AS ENUM ('PlanExpiry', 'StorageWarning');

CREATE TABLE webknossos.organization_notifiedEmailThresholds(
  _organization TEXT NOT NULL,
  emailThresholdType webknossos.EMAIL_THRESHOLD_TYPE NOT NULL,
  threshold INT NOT NULL, -- PlanExpiry: lead time in days, StorageWarning: used storage in percent. Deleted again to re-arm the email.
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (_organization, emailThresholdType, threshold),
  CONSTRAINT validOrganizationId CHECK (_organization ~* '^[A-Za-z0-9\-_. ]+$')
);

ALTER TABLE webknossos.organization_notifiedEmailThresholds
  ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES webknossos.organizations(_id) ON DELETE CASCADE DEFERRABLE;

-- Reminders for an earlier expiry date are already re-armed, so only those for the current one are carried over.
INSERT INTO webknossos.organization_notifiedEmailThresholds(_organization, emailThresholdType, threshold, created)
SELECT r._organization, 'PlanExpiry', r.leadTimeDays, r.created
FROM webknossos.organization_planExpiryReminders r
JOIN webknossos.organizations o ON o._id = r._organization
WHERE r.paidUntil = o.paidUntil;

DROP TABLE webknossos.organization_planExpiryReminders;

UPDATE webknossos.releaseInformation SET schemaVersion = 192;

COMMIT TRANSACTION;
