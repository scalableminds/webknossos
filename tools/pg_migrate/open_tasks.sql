WITH
  _projects AS (
    SELECT
      p._id
    FROM 
      projects p 
      JOIN tasks t ON t._project = p._id
      JOIN annotations a ON a._task = t._id
      JOIN users u ON u._id = a._user
      JOIN user_team_roles ut ON ut._user = u._id
      JOIN user_experiences ue ON ue._user = u._id
    WHERE
      p._team = '55c8bc233100004d016202ee' AND
      p.paused = FALSE AND
      t.neededExperience_domain = ue.domain AND
      a.modified > NOW() - INTERVAL '30 days'
    GROUP BY p._id)
SELECT
  s1.name,
  s1.totalinstances,
  s1.openinstances,
  s2.finished,
  s3.progress
FROM
  (
    SELECT
      p._id,
      p.name,
      SUM(t.totalinstances) totalinstances,
      SUM(t.openinstances) openinstances
    FROM
      projects p
      JOIN tasks t ON t._project = p._id
    WHERE
      p._id IN (SELECT _id FROM _projects)
    GROUP BY
      p._id
  ) s1 JOIN
  (
    SELECT
      p._id,
      p.name,
      COUNT(a._id) finished
    FROM
      projects p
      JOIN tasks t ON t._project = p._id
      JOIN annotations a ON a._task = t._id
    WHERE
      a.state = 'Finished' AND
      p._id IN (SELECT _id FROM _projects)
    GROUP BY
      p._id
  ) s2 ON s1._id = s2._id JOIN
  (
    SELECT
      p._id,
      p.name,
      COUNT(a._id) progress
    FROM
      projects p
      JOIN tasks t ON t._project = p._id
      JOIN annotations a ON a._task = t._id
    WHERE
      a.state = 'InProgress' AND
      p._id IN (SELECT _id FROM _projects)
    GROUP BY
      p._id
  ) s3 ON s1._id = s3._id
