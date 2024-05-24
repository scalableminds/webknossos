package models.job

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import models.job.JobState.JobState
import models.job.JobCommand.JobCommand
import play.api.libs.json.{JsObject, Json}
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.TransactionIsolation.Serializable
import slick.lifted.Rep
import utils.sql.{SQLDAO, SqlClient, SqlToken}
import utils.ObjectId

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

case class Job(
    _id: ObjectId,
    _owner: ObjectId,
    _dataStore: String,
    command: JobCommand,
    commandArgs: JsObject = Json.obj(),
    state: JobState = JobState.PENDING,
    manualState: Option[JobState] = None,
    _worker: Option[ObjectId] = None,
    latestRunId: Option[String] = None,
    returnValue: Option[String] = None,
    started: Option[Long] = None,
    ended: Option[Long] = None,
    created: Instant = Instant.now,
    isDeleted: Boolean = false
) {
  def isEnded: Boolean = {
    val relevantState = manualState.getOrElse(state)
    relevantState == JobState.SUCCESS || state == JobState.FAILURE
  }

  def duration: Option[FiniteDuration] =
    for {
      e <- ended
      s <- started
    } yield (e - s).millis

  private def effectiveState: JobState = manualState.getOrElse(state)

  def exportFileName: Option[String] = argAsStringOpt("export_file_name")

  def datasetName: Option[String] = argAsStringOpt("dataset_name")

  private def argAsStringOpt(key: String) = (commandArgs \ key).toOption.flatMap(_.asOpt[String])

  def resultLink(organizationName: String): Option[String] =
    if (effectiveState != JobState.SUCCESS) None
    else {
      command match {
        case JobCommand.convert_to_wkw | JobCommand.compute_mesh_file =>
          datasetName.map { dsName =>
            s"/datasets/$organizationName/$dsName/view"
          }
        case JobCommand.export_tiff | JobCommand.render_animation =>
          Some(s"/api/jobs/${this._id}/export")
        case JobCommand.infer_nuclei | JobCommand.infer_neurons | JobCommand.materialize_volume_annotation =>
          returnValue.map { resultDatasetName =>
            s"/datasets/$organizationName/$resultDatasetName/view"
          }
        case _ => None
      }
    }

  def resultLinkPublic(organizationName: String, webknossosPublicUrl: String): Option[String] =
    for {
      resultLink <- resultLink(organizationName)
      resultLinkPublic = if (resultLink.startsWith("/")) s"$webknossosPublicUrl$resultLink"
      else s"$resultLink"
    } yield resultLinkPublic

  def resultLinkSlackFormatted(organizationName: String, webknossosPublicUrl: String): Option[String] =
    for {
      resultLink <- resultLinkPublic(organizationName, webknossosPublicUrl)
      resultLinkFormatted = s" <$resultLink|Result>"
    } yield resultLinkFormatted
}

class JobDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[Job, JobsRow, Jobs](sqlClient) {
  protected val collection = Jobs

  protected def idColumn(x: Jobs): Rep[String] = x._Id
  protected def isDeletedColumn(x: Jobs): Rep[Boolean] = x.isdeleted

  protected def parse(r: JobsRow): Fox[Job] =
    for {
      manualStateOpt <- Fox.runOptional(r.manualstate)(JobState.fromString)
      state <- JobState.fromString(r.state)
      command <- JobCommand.fromString(r.command)
    } yield {
      Job(
        ObjectId(r._Id),
        ObjectId(r._Owner),
        r._Datastore.trim,
        command,
        Json.parse(r.commandargs).as[JsObject],
        state,
        manualStateOpt,
        r._Worker.map(ObjectId(_)),
        r.latestrunid,
        r.returnvalue,
        r.started.map(_.getTime),
        r.ended.map(_.getTime),
        Instant.fromSql(r.created),
        r.isdeleted
      )
    }

  override protected def readAccessQ(requestingUserId: ObjectId) =
    q"""
      _owner = $requestingUserId
      OR
      (_owner IN (SELECT _user FROM webknossos.user_team_roles WHERE _team IN (SELECT _team FROM webknossos.user_team_roles WHERE _user = $requestingUserId AND isTeamManager)))
      OR
      ((SELECT u._organization FROM webknossos.users_ u WHERE u._id = _owner) IN (SELECT _organization FROM webknossos.users_ WHERE _id = $requestingUserId AND isAdmin))
      OR
      ($requestingUserId IN
        (
          SELECT u._id
          FROM webknossos.users_ u JOIN webknossos.multiUsers_ m ON u._multiUser = m._id
          WHERE m.isSuperUser
        )
      )
     """

  private def listAccessQ(requestingUserId: ObjectId) =
    q"""_owner = $requestingUserId"""

  override def findAll(implicit ctx: DBAccessContext): Fox[List[Job]] =
    for {
      accessQuery <- accessQueryFromAccessQ(listAccessQ)
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE $accessQuery ORDER BY created".as[JobsRow])
      parsed <- parseAll(r)
    } yield parsed

  override def findOne(jobId: ObjectId)(implicit ctx: DBAccessContext): Fox[Job] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE $accessQuery AND _id = $jobId".as[JobsRow])
      parsed <- parseFirst(r, jobId)
    } yield parsed

  def countUnassignedPendingForDataStore(dataStoreName: String, jobCommands: Set[JobCommand]): Fox[Int] =
    if (jobCommands.isEmpty) Fox.successful(0)
    else {
      for {
        r <- run(q"""SELECT COUNT(*) from $existingCollectionName
                   WHERE state = ${JobState.PENDING}
                   AND command IN ${SqlToken.tupleFromList(jobCommands)}
                   AND manualState IS NULL
                   AND _dataStore = $dataStoreName
                   AND _worker IS NULL""".as[Int])
        head <- r.headOption
      } yield head
    }

  def countUnfinishedByWorker(workerId: ObjectId, jobCommands: Set[JobCommand]): Fox[Int] =
    if (jobCommands.isEmpty) Fox.successful(0)
    else {
      for {
        r <- run(q"""SELECT COUNT(*)
                     FROM $existingCollectionName
                     WHERE _worker = $workerId
                     AND state IN ${SqlToken.tupleFromValues(JobState.PENDING, JobState.STARTED)}
                     AND command IN ${SqlToken.tupleFromList(jobCommands)}
                     AND manualState IS NULL""".as[Int])
        head <- r.headOption
      } yield head
    }

  def findAllUnfinishedByWorker(workerId: ObjectId): Fox[List[Job]] =
    for {
      r <- run(q"""SELECT $columns from $existingCollectionName
                   WHERE _worker = $workerId AND state IN ${SqlToken
        .tupleFromValues(JobState.PENDING, JobState.STARTED)}
                   AND manualState IS NULL
                   ORDER BY created""".as[JobsRow])
      parsed <- parseAll(r)
    } yield parsed

  /*
   * Jobs that are cancelled by the user (manualState set to cancelled)
   * but not yet cancelled in the worker (state not yet set to cancelled)
   * are sent to the worker in to_cancel list. These are gathered here.
   * Compare the note on the job cancelling protocol in JobsController
   */
  def findAllCancellingByWorker(workerId: ObjectId): Fox[List[Job]] =
    for {
      r <- run(q"""SELECT $columns from $existingCollectionName
                   WHERE _worker = $workerId
                   AND state != ${JobState.CANCELLED}
                   AND manualState = ${JobState.CANCELLED}""".as[JobsRow])
      parsed <- parseAll(r)
    } yield parsed

  def insertOne(j: Job): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.jobs(
                    _id, _owner, _dataStore, command, commandArgs,
                    state, manualState, _worker,
                    latestRunId, returnValue, started, ended,
                    created, isDeleted
                   )
                   VALUES(
                    ${j._id}, ${j._owner}, ${j._dataStore}, ${j.command}, ${j.commandArgs},
                    ${j.state}, ${j.manualState}, ${j._worker},
                    ${j.latestRunId}, ${j.returnValue}, ${j.started}, ${j.ended},
                    ${j.created}, ${j.isDeleted})""".asUpdate)
    } yield ()

  def updateManualState(id: ObjectId, manualState: JobState)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q"""UPDATE webknossos.jobs SET manualState = $manualState WHERE _id = $id""".asUpdate)
    } yield ()

  def updateStatus(jobId: ObjectId, s: JobStatus): Fox[Unit] =
    for {
      _ <- run(q"""UPDATE webknossos.jobs SET
                   latestRunId = ${s.latestRunId},
                   state = ${s.state},
                   returnValue = ${s.returnValue},
                   started = ${s.started},
                   ended = ${s.ended}
                   WHERE _id = $jobId""".asUpdate)
    } yield ()

  def reserveNextJob(worker: Worker, jobCommands: Set[JobCommand]): Fox[Unit] =
    if (jobCommands.isEmpty) Fox.successful(())
    else {
      val query =
        q"""
          WITH subquery AS (
            SELECT _id
            FROM $existingCollectionName
            WHERE
              state = ${JobState.PENDING}
              AND _dataStore = ${worker._dataStore}
              AND manualState IS NULL
              AND _worker IS NULL
              AND command IN ${SqlToken.tupleFromList(jobCommands)}
            ORDER BY created
            LIMIT 1
          )
          UPDATE webknossos.jobs_ j
          SET _worker = ${worker._id}
          FROM subquery
          WHERE j._id = subquery._id
          """.asUpdate
      for {
        _ <- run(
          query.withTransactionIsolation(Serializable),
          retryCount = 50,
          retryIfErrorContains = List(transactionSerializationError)
        )
      } yield ()
    }

  def countByState: Fox[Map[String, Int]] =
    for {
      result <- run(q"""SELECT state, count(_id)
                        FROM webknossos.jobs_
                        WHERE manualState IS NULL
                        GROUP BY state
                        ORDER BY state
                        """.as[(String, Int)])
    } yield result.toMap

}
