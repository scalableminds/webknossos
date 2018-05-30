-- https://github.com/scalableminds/webknossos/pull/2483


-- UP:

ALTER TYPE webknossos.ANNOTATION_STATE ADD VALUE 'Initializing';

-- DOWN:

-- removing enum values from the type is not supported in postgresql
-- also, there are no permanent annotations with this state, so we don't have to remove them here

