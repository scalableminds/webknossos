START TRANSACTION;

ALTER TABLE webknossos.voxelytics_chunks
	ADD COLUMN beginTime TIMESTAMPTZ,
	ADD COLUMN endTime TIMESTAMPTZ,
	ADD COLUMN state webknossos.voxelytics_run_state NOT NULL DEFAULT 'PENDING';
ALTER TABLE webknossos.voxelytics_tasks
	ADD COLUMN beginTime TIMESTAMPTZ,
	ADD COLUMN endTime TIMESTAMPTZ,
	ADD COLUMN state webknossos.voxelytics_run_state NOT NULL DEFAULT 'PENDING';
ALTER TABLE webknossos.voxelytics_runs
	ADD COLUMN beginTime TIMESTAMPTZ,
	ADD COLUMN endTime TIMESTAMPTZ,
	ADD COLUMN state webknossos.voxelytics_run_state NOT NULL DEFAULT 'PENDING';


UPDATE
	webknossos.voxelytics_chunks u
SET
	state = c.state,
	beginTime = c.beginTime,
	endTime = c.endTime
FROM (
	SELECT
		c._id,
		chunk_state.state AS state,
		chunk_begin.timestamp AS beginTime,
		chunk_end.timestamp AS endTime
	FROM
		webknossos.voxelytics_chunks c
		JOIN webknossos.voxelytics_tasks t ON t._id = c._task
		JOIN ( SELECT DISTINCT ON (_chunk)
				_chunk,
				state
			FROM
				webknossos.voxelytics_chunkStateChangeEvents
			ORDER BY
				_chunk,
				timestamp DESC) chunk_state ON c._id = chunk_state._chunk
		LEFT JOIN ( SELECT DISTINCT ON (_chunk)
				_chunk,
				timestamp
			FROM
				webknossos.voxelytics_chunkStateChangeEvents
			WHERE
				state = 'RUNNING'
			ORDER BY
				_chunk,
				timestamp) chunk_begin ON c._id = chunk_begin._chunk
		LEFT JOIN ( SELECT DISTINCT ON (_chunk)
				_chunk,
				timestamp
			FROM
				webknossos.voxelytics_chunkStateChangeEvents
			WHERE
				state IN('COMPLETE', 'FAILED', 'CANCELLED')
			ORDER BY
				_chunk,
				timestamp DESC) chunk_end ON c._id = chunk_end._chunk) c
WHERE
	u._id = c._id;


UPDATE
	webknossos.voxelytics_tasks u
SET
	state = c.state,
	beginTime = c.beginTime,
	endTime = c.endTime
FROM (
	SELECT
		t._id,
		task_state.state AS state,
		task_begin.timestamp AS beginTime,
		task_end.timestamp AS endTime
	FROM
		webknossos.voxelytics_tasks t
		JOIN ( SELECT DISTINCT ON (_task)
				_task,
				state
			FROM
				webknossos.voxelytics_taskStateChangeEvents
			ORDER BY
				_task,
				timestamp DESC) task_state ON t._id = task_state._task
		LEFT JOIN ( SELECT DISTINCT ON (_task)
				_task,
				timestamp
			FROM
				webknossos.voxelytics_taskStateChangeEvents
			WHERE
				state = 'RUNNING'
			ORDER BY
				_task,
				timestamp) task_begin ON t._id = task_begin._task
		LEFT JOIN ( SELECT DISTINCT ON (_task)
				_task,
				timestamp
			FROM
				webknossos.voxelytics_taskStateChangeEvents
			WHERE
				state IN('COMPLETE', 'FAILED', 'CANCELLED')
			ORDER BY
				_task,
				timestamp DESC) task_end ON t._id = task_end._task) c
WHERE
	u._id = c._id;


UPDATE
	webknossos.voxelytics_runs u
SET
	state = c.state,
	beginTime = c.beginTime,
	endTime = c.endTime
FROM (
	SELECT
		r._id,
		run_state.state AS state,
		run_begin.timestamp AS beginTime,
		run_end.timestamp AS endTime
	FROM
		webknossos.voxelytics_runs r
		JOIN ( SELECT DISTINCT ON (_run)
				_run,
				state
			FROM
				webknossos.voxelytics_runStateChangeEvents
			ORDER BY
				_run,
				timestamp DESC) run_state ON r._id = run_state._run
			JOIN ( SELECT DISTINCT ON (_run)
					_run,
					timestamp
				FROM
					webknossos.voxelytics_runStateChangeEvents
				WHERE
					state = 'RUNNING'
				ORDER BY
					_run,
					timestamp) run_begin ON r._id = run_begin._run
			LEFT JOIN ( SELECT DISTINCT ON (_run)
					_run,
					timestamp
				FROM
					webknossos.voxelytics_runStateChangeEvents
				WHERE
					state IN('COMPLETE', 'FAILED', 'CANCELLED')
				ORDER BY
					_run,
					timestamp DESC) run_end ON r._id = run_end._run) c
WHERE
	u._id = c._id;

-- Don't delete right now, because it cannot be rolled back easily
DROP TABLE webknossos.voxelytics_chunkStateChangeEvents;
DROP TABLE webknossos.voxelytics_taskStateChangeEvents;
DROP TABLE webknossos.voxelytics_runStateChangeEvents;

UPDATE webknossos.releaseInformation
SET schemaVersion = 98;

COMMIT TRANSACTION;
