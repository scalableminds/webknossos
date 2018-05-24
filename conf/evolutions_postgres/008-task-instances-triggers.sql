-- https://github.com/scalableminds/webknossos/pull/2594

-- UP:


BEGIN;

-- TODO: fix negative openInstances in existing tasks

DROP VIEW webknossos.tasks_;
ALTER TABLE webknossos.tasks ADD COLUMN openInstances BIGINT;
UPDATE webknossos.tasks t SET openInstances = (SELECT openInstances FROM webknossos.task_instances ti where ti._id = t._id);
ALTER TABLE webknossos.tasks ALTER COLUMN openInstances SET NOT NULL;
ALTER TABLE webknossos.tasks ADD CONSTRAINT openInstancesSmallEnoughCheck CHECK (openInstances <= totalInstances);
ALTER TABLE webknossos.tasks ADD CONSTRAINT openInstancesLargeEnoughCheck CHECK (openInstances >= 0);
CREATE VIEW webknossos.tasks_ AS SELECT * FROM webknossos.tasks WHERE NOT isDeleted;



DROP FUNCTION webknossos.checkOpenAssignments CASCADE;
DROP VIEW webknossos.task_instances;



CREATE FUNCTION webknossos.countsAsTaskInstance(a webknossos.annotations) RETURNS BOOLEAN AS $$
  BEGIN
    RETURN (a.state != 'Cancelled' AND a.isDeleted = false AND a.typ = 'Task');
  END;
$$ LANGUAGE plpgsql;


CREATE FUNCTION webknossos.onUpdateTask() RETURNS trigger AS $$
  BEGIN
    IF NEW.totalInstances > OLD.totalInstances THEN
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

COMMIT;











-- DOWN:

BEGIN;

DROP VIEW webknossos.tasks_;
ALTER TABLE webknossos.tasks DROP CONSTRAINT openInstancesSmallEnoughCheck;
ALTER TABLE webknossos.tasks DROP CONSTRAINT openInstancesLargeEnoughCheck;
ALTER TABLE webknossos.tasks DROP COLUMN openInstances;
CREATE VIEW webknossos.tasks_ AS SELECT * FROM webknossos.tasks WHERE NOT isDeleted;

DROP FUNCTION webknossos.onDeleteAnnotation CASCADE;
DROP FUNCTION webknossos.onInsertAnnotation CASCADE;
DROP FUNCTION webknossos.onUpdateAnnotation CASCADE;
DROP FUNCTION webknossos.onUpdateTask CASCADE;
DROP FUNCTION webknossos.countsAsTaskInstance CASCADE;

CREATE VIEW webknossos.task_instances AS
  SELECT t._id, COUNT(annotations._id) assignedInstances, t.totalinstances - COUNT(annotations._id) openInstances
  FROM webknossos.tasks t
  left join (select * from webknossos.annotations a where typ = 'Task' and a.state != 'Cancelled' AND a.isDeleted = false) as annotations ON t._id = annotations._task
  GROUP BY t._id, t.totalinstances;



CREATE FUNCTION webknossos.checkOpenAssignments() RETURNS trigger AS $$
  DECLARE
    cur CURSOR for SELECT openInstances FROM webknossos.task_instances where NEW.typ = 'Task' and _id = NEW._task;
  BEGIN
    IF NEW.typ = 'Task' THEN
      FOR rec IN cur LOOP
        IF rec.openInstances < 0 THEN
          RAISE EXCEPTION 'Negative openInstances for Task (%)', NEW._task;
        END IF;
      END LOOP;
    END IF;
    RETURN NULL;
  END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER checkOpenAssignmentsTrigger
AFTER INSERT ON webknossos.annotations
FOR EACH ROW EXECUTE PROCEDURE webknossos.checkOpenAssignments();

COMMIT;
