package models.job

import org.apache.pekko.actor.ActorSystem
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.helpers.IntervalScheduler
import com.scalableminds.webknossos.schema.Tables._
import com.typesafe.scalalogging.LazyLogging
import models.job.JobCommand.JobCommand
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.{JsObject, Json}
import slick.lifted.Rep
import telemetry.SlackNotificationService
import utils.sql.{SQLDAO, SqlClient}
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

case class Worker(_id: ObjectId,
                  _dataStore: String,
                  name: String,
                  key: String,
                  maxParallelHighPriorityJobs: Int,
                  maxParallelLowPriorityJobs: Int,
                  supportedJobCommands: Set[JobCommand],
                  lastHeartBeat: Instant = Instant.zero,
                  created: Instant = Instant.now,
                  isDeleted: Boolean = false)

class WorkerDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[Worker, WorkersRow, Workers](sqlClient) {
  protected val collection = Workers

  protected def idColumn(x: Workers): Rep[String] = x._Id

  protected def isDeletedColumn(x: Workers): Rep[Boolean] = x.isdeleted

  protected def parse(r: WorkersRow): Fox[Worker] =
    for {
      supportedJobCommands <- Fox.serialCombined(parseArrayLiteral(r.supportedjobcommands)) { s =>
        JobCommand.fromString(s).toFox ?~> f"$s is not a valid job command"
      }
    } yield
      Worker(
        ObjectId(r._Id),
        r._Datastore,
        r.name,
        r.key,
        r.maxparallelhighpriorityjobs,
        r.maxparallellowpriorityjobs,
        supportedJobCommands.toSet,
        Instant.fromSql(r.lastheartbeat),
        Instant.fromSql(r.created),
        r.isdeleted
      )

  def findOneByKey(key: String): Fox[Worker] =
    for {
      r: Seq[WorkersRow] <- run(q"SELECT $columns FROM $existingCollectionName WHERE key = $key".as[WorkersRow])
      parsed <- parseFirst(r, "key")
    } yield parsed

  def findAllByDataStore(dataStoreName: String): Fox[List[Worker]] =
    for {
      r: Seq[WorkersRow] <- run(
        q"SELECT $columns FROM $existingCollectionName WHERE _dataStore = $dataStoreName".as[WorkersRow])
      parsed <- parseAll(r)
    } yield parsed

  def updateHeartBeat(_id: ObjectId): Unit = {
    run(q"UPDATE webknossos.workers SET lastHeartBeat = NOW() WHERE _id = ${_id}".asUpdate)
    // Note that this should not block the jobs polling operation, failures here are not critical
    ()
  }
}

class WorkerService @Inject()(conf: WkConf) {

  def lastHeartBeatIsRecent(worker: Worker): Boolean =
    Instant.since(worker.lastHeartBeat) < conf.Jobs.workerLivenessTimeout

  def publicWrites(worker: Worker): JsObject =
    Json.obj(
      "id" -> worker._id.id,
      "name" -> worker.name,
      "maxParallelHighPriorityJobs" -> worker.maxParallelHighPriorityJobs,
      "maxParallelLowPriorityJobs" -> worker.maxParallelLowPriorityJobs,
      "supportedJobCommands" -> worker.supportedJobCommands,
      "created" -> worker.created,
      "lastHeartBeat" -> worker.lastHeartBeat,
      "lastHeartBeatIsRecent" -> lastHeartBeatIsRecent(worker)
    )

}

class WorkerLivenessService @Inject()(workerService: WorkerService,
                                      workerDAO: WorkerDAO,
                                      slackNotificationService: SlackNotificationService,
                                      val lifecycle: ApplicationLifecycle,
                                      val system: ActorSystem)(implicit val ec: ExecutionContext)
    extends IntervalScheduler
    with Formatter
    with LazyLogging {

  override protected def tickerInitialDelay: FiniteDuration = 1 minute

  override protected def tickerInterval: FiniteDuration = 1 minute

  override protected def tick(): Unit = {
    for {
      workers <- workerDAO.findAll(GlobalAccessContext)
      _ = workers.foreach(reportIfLivenessChanged)
    } yield ()
    ()
  }

  private val reportedAsDead: scala.collection.mutable.Set[ObjectId] = scala.collection.mutable.Set()

  private def reportIfLivenessChanged(worker: Worker): Unit = {
    val heartBeatIsRecent = workerService.lastHeartBeatIsRecent(worker)
    if (!heartBeatIsRecent && !reportedAsDead.contains(worker._id)) {
      reportAsDead(worker)
      reportedAsDead.add(worker._id)
    }
    if (heartBeatIsRecent && reportedAsDead.contains(worker._id)) {
      reportAsResurrected(worker)
      reportedAsDead.remove(worker._id)
    }
  }

  private def reportAsDead(worker: Worker): Unit = {
    val msg =
      s"Worker ${worker.name} (${worker._id}) is not reporting. Last heartbeat was at ${worker.lastHeartBeat}"
    slackNotificationService.warn("Worker missing", msg)
    logger.warn(msg)
  }

  private def reportAsResurrected(worker: Worker): Unit = {
    val msg =
      s"Worker ${worker.name} (${worker._id}) is reporting again. Last heartbeat was at ${worker.lastHeartBeat}"
    slackNotificationService.success("Worker return", msg)
    logger.info(msg)
  }

}
