-- https://github.com/scalableminds/webknossos/pull/2532

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
