START TRANSACTION;

ALTER TABLE webknossos.tasks ADD CONSTRAINT openInstancesSmallEnoughCheck CHECK (openInstances <= totalInstances);
DROP FUNCTION webknossos.onUpdateTask CASCADE;

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

UPDATE webknossos.releaseInformation SET schemaVersion = 25;

COMMIT TRANSACTION;
