START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 130, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

CREATE INDEX ON webknossos.users(created);
CREATE INDEX ON webknossos.users(_organization);
CREATE INDEX ON webknossos.users(isDeactivated);
CREATE INDEX ON webknossos.users(isUnlisted);

-- Make spelling of false to be written in caps.
CREATE OR REPLACE FUNCTION webknossos.countsAsTaskInstance(a webknossos.annotations) RETURNS BOOLEAN AS $$
  BEGIN
    RETURN (a.state != 'Cancelled' AND a.isDeleted = FALSE AND a.typ = 'Task');
  END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION webknossos.onInsertAnnotation() RETURNS trigger AS $$
  BEGIN
    IF (NEW.typ = 'Task') AND (NEW.isDeleted = FALSE) AND (NEW.state != 'Cancelled') THEN
      UPDATE webknossos.tasks SET pendingInstances = pendingInstances - 1 WHERE _id = NEW._task;
    END IF;
    RETURN NULL;
  END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION webknossos.onDeleteAnnotation() RETURNS TRIGGER AS $$
  BEGIN
    IF (OLD.typ = 'Task') AND (OLD.isDeleted = FALSE) AND (OLD.state != 'Cancelled') THEN
      UPDATE webknossos.tasks SET pendingInstances = pendingInstances + 1 WHERE _id = OLD._task;
    END IF;
    RETURN NULL;
  END;
$$ LANGUAGE plpgsql;

UPDATE webknossos.releaseInformation SET schemaVersion = 131;

COMMIT TRANSACTION;
