START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 190 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

CREATE TYPE webknossos.ALERT_EMAIL_TYPE AS ENUM ('PlanExpiry', 'StorageWarning');

CREATE TABLE webknossos.organization_alertEmails(
  _organization TEXT NOT NULL,
  emailType webknossos.ALERT_EMAIL_TYPE NOT NULL,
  threshold INT NOT NULL, -- PlanExpiry: lead time in days, StorageWarning: used storage in percent. Deleted again to re-arm the email.
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (_organization, emailType, threshold),
  CONSTRAINT validOrganizationId CHECK (_organization ~* '^[A-Za-z0-9\-_. ]+$')
);

ALTER TABLE webknossos.organization_alertEmails
  ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES webknossos.organizations(_id) ON DELETE CASCADE DEFERRABLE;

-- Reminders for an earlier expiry date are already re-armed, so only those for the current one are carried over.
INSERT INTO webknossos.organization_alertEmails(_organization, emailType, threshold, created)
SELECT r._organization, 'PlanExpiry', r.leadTimeDays, r.created
FROM webknossos.organization_planExpiryReminders r
JOIN webknossos.organizations o ON o._id = r._organization
WHERE r.paidUntil = o.paidUntil;

DROP TABLE webknossos.organization_planExpiryReminders;

UPDATE webknossos.releaseInformation SET schemaVersion = 191;

COMMIT TRANSACTION;
