START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 107, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.tasks_;

DROP TRIGGER onUpdateAnnotationTrigger ON webknossos.annotations;
DROP TRIGGER onInsertAnnotationTrigger ON webknossos.annotations;
DROP TRIGGER onDeleteAnnotationTrigger ON webknossos.annotations;
DROP TRIGGER onUpdateTaskTrigger ON webknossos.tasks;

DROP FUNCTION webknossos.onUpdateAnnotation;
DROP FUNCTION webknossos.onInsertAnnotation;
DROP FUNCTION webknossos.onDeleteAnnotation;
DROP FUNCTION webknossos.onUpdateTask;

ALTER TABLE webknossos.tasks DROP CONSTRAINT pendingInstancesLargeEnoughCheck;
ALTER TABLE webknossos.tasks RENAME COLUMN pendingInstances TO openInstances;
ALTER TABLE webknossos.tasks ADD CONSTRAINT openInstancesLargeEnoughCheck CHECK (openInstances >= 0);

CREATE VIEW webknossos.tasks_ AS SELECT * FROM webknossos.tasks WHERE NOT isDeleted;
CREATE FUNCTION webknossos.onUpdateTask() RETURNS trigger AS $$
  BEGIN
    IF NEW.totalInstances <> OLD.totalInstances THEN
      UPDATE webknossos.tasks SET openInstances = openInstances + (NEW.totalInstances - OLD.totalInstances) WHERE _id = NEW._id;
    END IF;
    RETURN NULL;
  END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER onUpdateTaskTrigger
AFTER UPDATE ON webknossos.tasks
FOR EACH ROW EXECUTE PROCEDURE webknossos.onUpdateTask();


CREATE FUNCTION webknossos.onInsertAnnotation() RETURNS trigger AS $$
  BEGIN
    IF (NEW.typ = 'Task') AND (NEW.isDeleted = false) AND (NEW.state != 'Cancelled') THEN
      UPDATE webknossos.tasks SET openInstances = openInstances - 1 WHERE _id = NEW._task;
    END IF;
    RETURN NULL;
  END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER onInsertAnnotationTrigger
AFTER INSERT ON webknossos.annotations
FOR EACH ROW EXECUTE PROCEDURE webknossos.onInsertAnnotation();



CREATE OR REPLACE FUNCTION webknossos.onUpdateAnnotation() RETURNS trigger AS $$
  BEGIN
    IF (NEW._task != OLD._task) OR (NEW.typ != OLD.typ) THEN
        RAISE EXCEPTION 'annotation columns _task and typ are immutable';
    END IF;
    IF (webknossos.countsAsTaskInstance(OLD) AND NOT webknossos.countsAsTaskInstance(NEW))
    THEN
      UPDATE webknossos.tasks SET openInstances = openInstances + 1 WHERE _id = NEW._task;
    END IF;
    IF (NOT webknossos.countsAsTaskInstance(OLD) AND webknossos.countsAsTaskInstance(NEW))
    THEN
      UPDATE webknossos.tasks SET openInstances = openInstances - 1 WHERE _id = NEW._task;
    END IF;
    RETURN NULL;
  END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER onUpdateAnnotationTrigger
AFTER UPDATE ON webknossos.annotations
FOR EACH ROW EXECUTE PROCEDURE webknossos.onUpdateAnnotation();


CREATE FUNCTION webknossos.onDeleteAnnotation() RETURNS trigger AS $$
  BEGIN
    IF (OLD.typ = 'Task') AND (OLD.isDeleted = false) AND (OLD.state != 'Cancelled') THEN
      UPDATE webknossos.tasks SET openInstances = openInstances + 1 WHERE _id = OLD._task;
    END IF;
    RETURN NULL;
  END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER onDeleteAnnotationTrigger
AFTER DELETE ON webknossos.annotations
FOR EACH ROW EXECUTE PROCEDURE webknossos.onDeleteAnnotation();


UPDATE webknossos.releaseInformation SET schemaVersion = 106;

COMMIT TRANSACTION;
