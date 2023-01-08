package models.voxelytics

import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.user.User
import models.voxelytics.VoxelyticsRunState.VoxelyticsRunState
import play.api.libs.json.{JsArray, JsObject, Json, OFormat}
import utils.ObjectId

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class RunEntry(id: ObjectId,
                    name: String,
                    username: String,
                    hostname: String,
                    voxelyticsVersion: String,
                    workflow_hash: String,
                    workflow_yamlContent: String,
                    workflow_config: JsObject,
                    state: VoxelyticsRunState,
                    beginTime: Instant,
                    endTime: Option[Instant])

object RunEntry {
  implicit val jsonFormat: OFormat[RunEntry] = Json.format[RunEntry]
}

case class TaskRunEntry(runId: ObjectId,
                        runName: String,
                        taskId: ObjectId,
                        taskName: String,
                        state: VoxelyticsRunState,
                        beginTime: Option[Instant],
                        endTime: Option[Instant],
                        currentExecutionId: Option[String],
                        chunks: ChunkStatistics)

object TaskRunEntry {
  implicit val jsonFormat: OFormat[TaskRunEntry] = Json.format[TaskRunEntry]
}

case class CombinedTaskRunEntry(taskName: String, currentExecutionId: Option[String], chunks: ChunkStatistics)

object CombinedTaskRunEntry {
  implicit val jsonFormat: OFormat[TaskRunEntry] = Json.format[TaskRunEntry]
}

case class WorkflowEntry(
    name: String,
    hash: String,
    _organization: ObjectId
)

object WorkflowEntry {
  implicit val jsonFormat: OFormat[WorkflowEntry] = Json.format[WorkflowEntry]
}

case class TaskStatistics(total: Long, failed: Long, skipped: Long, complete: Long, cancelled: Long)

object TaskStatistics {
  implicit val jsonFormat: OFormat[TaskStatistics] = Json.format[TaskStatistics]
}

case class ChunkStatistics(total: Long, failed: Long, skipped: Long, complete: Long, cancelled: Long)

object ChunkStatistics {
  implicit val jsonFormat: OFormat[ChunkStatistics] = Json.format[ChunkStatistics]
}

case class WorkflowListingRunEntry(id: ObjectId,
                                   name: String,
                                   username: String,
                                   hostname: String,
                                   voxelyticsVersion: String,
                                   workflow_hash: String,
                                   state: VoxelyticsRunState,
                                   beginTime: Instant,
                                   endTime: Option[Instant],
                                   taskStatistics: TaskStatistics)

object WorkflowListingRunEntry {
  implicit val jsonFormat: OFormat[WorkflowListingRunEntry] = Json.format[WorkflowListingRunEntry]
}

case class ArtifactEntry(artifactId: ObjectId,
                         taskId: ObjectId,
                         name: String,
                         path: String,
                         fileSize: Long,
                         inodeCount: Long,
                         version: String,
                         metadata: JsObject,
                         taskName: String)

object ArtifactEntry {
  implicit val jsonFormat: OFormat[ArtifactEntry] = Json.format[ArtifactEntry]
}

case class TaskEntry(taskId: ObjectId, runId: ObjectId, name: String, task: String, config: JsObject)

object TaskEntry {
  implicit val jsonFormat: OFormat[TaskEntry] = Json.format[TaskEntry]
}

case class StatisticsEntry(max: Double, median: Double, stddev: Double, sum: Option[Double] = None)

object StatisticsEntry {
  implicit val jsonFormat: OFormat[StatisticsEntry] = Json.format[StatisticsEntry]
}

case class ChunkStatisticsEntry(executionId: String,
                                counts: ChunkStatistics,
                                beginTime: Instant,
                                endTime: Instant,
                                wallTime: Double,
                                memory: StatisticsEntry,
                                cpuUser: StatisticsEntry,
                                cpuSystem: StatisticsEntry,
                                duration: StatisticsEntry)

object ChunkStatisticsEntry {
  implicit val jsonFormat: OFormat[ChunkStatisticsEntry] = Json.format[ChunkStatisticsEntry]
}

case class ArtifactChecksumEntry(taskName: String,
                                 artifactName: String,
                                 path: String,
                                 resolvedPath: String,
                                 timestamp: Instant,
                                 checksumMethod: String,
                                 checksum: String,
                                 fileSize: Long,
                                 lastModified: Instant)

object ArtifactChecksumEntry {
  implicit val jsonFormat: OFormat[ArtifactChecksumEntry] = Json.format[ArtifactChecksumEntry]
}

class VoxelyticsService @Inject()(voxelyticsDAO: VoxelyticsDAO)(implicit ec: ExecutionContext) extends FoxImplicits {

  def checkAuth(runId: ObjectId, user: User): Fox[Unit] =
    for {
      runUserId <- voxelyticsDAO.getUserIdForRun(runId)
    } yield bool2Fox(user.isAdmin || runUserId == user._id)

  def checkAuthForWorkflowCreation(runName: String, user: User): Fox[Unit] =
    for {
      runUserId <- voxelyticsDAO.getUserIdForRunOpt(runName, user._organization)
    } yield bool2Fox(user.isAdmin || runUserId.forall(_ == user._id))

  def taskRunsPublicWrites(combinedTaskRuns: List[CombinedTaskRunEntry], taskRuns: List[TaskRunEntry]): JsArray = {
    val groupedTaskRuns = taskRuns.groupBy(_.taskName)
    JsArray(
      groupedTaskRuns
        .map(group => {
          val sortedTaskRuns = group._2.sortBy(_.beginTime).reverse
          val combinedTaskRun = combinedTaskRuns.find(_.taskName == group._1)
          Json.obj(
            "taskName" -> group._1,
            "state" -> sortedTaskRuns.head.state,
            "beginTime" -> sortedTaskRuns.head.beginTime,
            "endTime" -> sortedTaskRuns.head.endTime,
            "currentExecutionId" -> combinedTaskRun.flatMap(_.currentExecutionId),
            "chunks" -> combinedTaskRun.map(_.chunks).getOrElse(ChunkStatistics(0, 0, 0, 0, 0)),
            "runs" -> sortedTaskRuns.map(run =>
              Json.obj(
                "runId" -> run.runId,
                "state" -> run.state,
                "beginTime" -> run.beginTime,
                "endTime" -> run.endTime,
                "currentExecutionId" -> run.currentExecutionId,
                "chunks" -> run.chunks
            ))
          )
        })
        .toList)
  }

  def artifactsPublicWrites(artifacts: List[ArtifactEntry]): JsObject = {
    val artifactsByTask = artifacts.groupBy(_.taskName)
    JsObject(artifactsByTask.map(artifactKV => {
      val taskName = artifactKV._1
      val artifacts = artifactKV._2
      (taskName, JsObject(artifacts.map(artifact => (artifact.name, Json.toJson(artifact)))))
    }))
  }

  def workflowConfigPublicWrites(workflowConfig: JsObject, tasks: List[TaskEntry]): JsObject =
    workflowConfig ++
      Json.obj("tasks" -> JsObject(tasks.map(t => (t.name, t.config ++ Json.obj("task" -> t.task)))))

  def upsertTaskWithArtifacts(runId: ObjectId,
                              taskName: String,
                              task: WorkflowDescriptionTaskConfig,
                              artifacts: Map[String, Map[String, WorkflowDescriptionArtifact]]): Fox[Unit] =
    for {
      taskId <- voxelyticsDAO.upsertTask(
        runId,
        taskName,
        task.task,
        Json.obj("config" -> task.config,
                 "description" -> task.description,
                 "distribution" -> task.distribution,
                 "inputs" -> task.inputs,
                 "output_paths" -> task.output_paths)
      )
      _ <- Fox.combined(
        artifacts
          .getOrElse(taskName, List.empty)
          .map(artifactKV => {
            val artifactName = artifactKV._1
            val artifact = artifactKV._2
            voxelyticsDAO.upsertArtifact(taskId,
                                         artifactName,
                                         artifact.path,
                                         artifact.file_size,
                                         artifact.inode_count,
                                         artifact.version,
                                         artifact.metadataAsJson)
          })
          .toList)
    } yield ()
}
