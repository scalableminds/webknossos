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
