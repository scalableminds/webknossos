package models.voxelytics

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.user.User
import models.voxelytics.RunState.RunState
import play.api.libs.json.{JsObject, Json, OFormat}
import utils.ObjectId

import java.time.Instant
import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.util.Try

case class RunEntry(runId: ObjectId,
                    name: String,
                    username: String,
                    hostname: String,
                    voxelyticsVersion: String,
                    workflow_hash: String,
                    workflow_yamlContent: String,
                    workflow_config: JsObject,
                    state: RunState,
                    beginTime: Instant,
                    endTime: Option[Instant])

case class TaskRunEntry(runName: String,
                        runId: ObjectId,
                        taskId: ObjectId,
                        taskName: String,
                        state: RunState,
                        beginTime: Option[Instant],
                        endTime: Option[Instant],
                        currentExecutionId: Option[String],
                        chunksTotal: Long,
                        chunksFinished: Long)

case class WorkflowEntry(
    name: String,
    hash: String
)

object WorkflowEntry {
  implicit val jsonFormat: OFormat[WorkflowEntry] = Json.format[WorkflowEntry]
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
                                countTotal: Long,
                                countFinished: Long,
                                beginTime: Instant,
                                endTime: Instant,
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

  def checkAuthCreateWorkflow(runName: String, user: User): Fox[Unit] =
    for {
      runUserId <- voxelyticsDAO.getUserIdForRunOpt(runName, user._organization)
    } yield bool2Fox(user.isAdmin || runUserId.forall(_ == user._id))

  def writesRun(run: RunEntry, tasks: List[TaskRunEntry]): JsObject =
    Json.obj(
      "id" -> run.runId.id,
      "name" -> run.name,
      "username" -> run.username,
      "hostname" -> run.hostname,
      "voxelyticsVersion" -> run.voxelyticsVersion,
      "beginTime" -> run.beginTime,
      "endTime" -> run.endTime,
      "state" -> run.state,
      "tasks" -> tasks.map(writesTaskRun)
    )

  private def writesTaskRun(taskRun: TaskRunEntry): JsObject =
    Json.obj(
      "runName" -> taskRun.runName,
      "runId" -> taskRun.runId.id,
      "taskId" -> taskRun.taskId.id,
      "taskName" -> taskRun.taskName,
      "state" -> taskRun.state,
      "beginTime" -> taskRun.beginTime,
      "endTime" -> taskRun.endTime,
      "currentExecutionId" -> taskRun.currentExecutionId,
      "chunksTotal" -> taskRun.chunksTotal,
      "chunksFinished" -> taskRun.chunksFinished
    )

  private def writesArtifactEntry(artifact: ArtifactEntry): (String, JsObject) =
    (artifact.name,
     artifact.metadata ++
       Json.obj(
         "artifactId" -> artifact.artifactId.id,
         "taskId" -> artifact.taskId.id,
         "name" -> artifact.name,
         "path" -> artifact.path,
         "fileSize" -> artifact.fileSize,
         "inodeCount" -> artifact.inodeCount,
         "version" -> artifact.version,
         "taskName" -> artifact.taskName
       ))

  def writesArtifacts(artifacts: List[ArtifactEntry]): JsObject = {
    val artifactsByTask = artifacts.groupBy(_.taskName)
    JsObject(artifactsByTask.map(artifactKV => {
      val artifactName = artifactKV._1
      val artifacts = artifactKV._2
      (artifactName, JsObject(artifacts.map(writesArtifactEntry)))
    }))
  }

  def writesWorkflowConfig(workflowConfig: JsObject, tasks: List[TaskEntry]): JsObject =
    workflowConfig ++ Json.obj("tasks" -> JsObject(tasks.map(t => (t.name, t.config ++ Json.obj("task" -> t.task)))))

  def aggregateBeginEndTime(runs: List[RunEntry]): (RunState, Instant, Option[Instant]) = {
    val state = runs.maxBy(_.beginTime).state
    val beginTime = runs.map(_.beginTime).min
    val endTime = Try(runs.flatMap(_.endTime).max).toOption

    (state, beginTime, endTime)
  }

  def upsertTask(runId: ObjectId,
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
      _ <- Fox.sequence(
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
                                         artifact.metadata)
          })
          .toList)
    } yield ()
}
