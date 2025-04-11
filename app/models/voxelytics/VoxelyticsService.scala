package models.voxelytics

import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.user.User
import models.voxelytics.VoxelyticsRunState.VoxelyticsRunState
import play.api.libs.json.{JsArray, JsObject, Json, OFormat}
import com.scalableminds.util.objectid.ObjectId

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.util.Try

case class RunEntry(id: ObjectId,
                    name: String,
                    hostUserName: String,
                    hostName: String,
                    voxelyticsVersion: String,
                    workflowHash: String,
                    workflowYamlContent: String,
                    workflowConfig: JsObject,
                    state: VoxelyticsRunState,
                    beginTime: Option[Instant],
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
                        chunkCounts: ChunkCounts)

object TaskRunEntry {
  implicit val jsonFormat: OFormat[TaskRunEntry] = Json.format[TaskRunEntry]
}

case class CombinedTaskRunEntry(taskName: String, currentExecutionId: Option[String], chunkCounts: ChunkCounts)

object CombinedTaskRunEntry {
  implicit val jsonFormat: OFormat[TaskRunEntry] = Json.format[TaskRunEntry]
}

case class WorkflowEntry(
    name: String,
    hash: String,
    _organization: String
)

object WorkflowEntry {
  implicit val jsonFormat: OFormat[WorkflowEntry] = Json.format[WorkflowEntry]
}

case class TaskCounts(total: Long,
                      failed: Long,
                      skipped: Long,
                      complete: Long,
                      cancelled: Long,
                      fileSize: Long,
                      inodeCount: Long)

object TaskCounts {
  implicit val jsonFormat: OFormat[TaskCounts] = Json.format[TaskCounts]
}

case class ChunkCounts(total: Long, failed: Long, skipped: Long, complete: Long, cancelled: Long)

object ChunkCounts {
  implicit val jsonFormat: OFormat[ChunkCounts] = Json.format[ChunkCounts]
}

case class WorkflowListingRunEntry(id: ObjectId,
                                   name: String,
                                   hostUserName: String,
                                   hostName: String,
                                   voxelyticsVersion: String,
                                   workflowHash: String,
                                   state: VoxelyticsRunState,
                                   beginTime: Option[Instant],
                                   endTime: Option[Instant],
                                   taskCounts: TaskCounts,
                                   userFirstName: Option[String],
                                   userLastName: Option[String])

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
                         taskName: String,
                         foreignWorkflow: Option[(String, String)])

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
                                chunkCounts: ChunkCounts,
                                beginTime: Option[Instant],
                                endTime: Option[Instant],
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
    } yield Fox.fromBool(user.isAdmin || runUserId == user._id)

  def checkAuthForWorkflowCreation(runName: String, user: User): Fox[Unit] =
    for {
      runUserId <- voxelyticsDAO.getUserIdForRunOpt(runName, user._organization)
    } yield Fox.fromBool(user.isAdmin || runUserId.forall(_ == user._id))

  def taskRunsPublicWrites(combinedTaskRuns: List[CombinedTaskRunEntry], taskRuns: List[TaskRunEntry]): JsArray = {
    val groupedTaskRuns = taskRuns.groupBy(_.taskName)
    JsArray(
      groupedTaskRuns
        .map(group => {
          val sortedTaskRuns = group._2.sortBy(_.beginTime).reverse
          val combinedTaskRun = combinedTaskRuns.find(_.taskName == group._1)
          val state = sortedTaskRuns
            .map(_.state)
            .find(s => s != VoxelyticsRunState.SKIPPED && s != VoxelyticsRunState.PENDING)
            .orElse(sortedTaskRuns.headOption.map(_.state))
            .getOrElse(VoxelyticsRunState.SKIPPED)
          val chunkCounts = combinedTaskRun.map(_.chunkCounts).getOrElse(ChunkCounts(0, 0, 0, 0, 0))
          Json.obj(
            "taskName" -> group._1,
            "state" -> state,
            "beginTime" -> Try(sortedTaskRuns.flatMap(_.beginTime).min).toOption,
            "endTime" -> Try(sortedTaskRuns.flatMap(_.endTime).max).toOption,
            "currentExecutionId" -> combinedTaskRun.flatMap(_.currentExecutionId),
            "chunkCounts" -> chunkCounts,
            "runs" -> sortedTaskRuns.map(taskRun =>
              Json.obj(
                "runId" -> taskRun.runId,
                "state" -> taskRun.state,
                "beginTime" -> taskRun.beginTime,
                "endTime" -> taskRun.endTime,
                "currentExecutionId" -> taskRun.currentExecutionId,
                "chunkCounts" -> taskRun.chunkCounts
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
