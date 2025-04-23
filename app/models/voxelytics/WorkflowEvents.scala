package models.voxelytics

import com.scalableminds.util.time.Instant
import models.voxelytics.VoxelyticsRunState.VoxelyticsRunState
import play.api.libs.json._

import java.util.Base64

trait WorkflowEvent {}

case class RunStateChangeEvent(state: VoxelyticsRunState, timestamp: Instant) extends WorkflowEvent

case class TaskStateChangeEvent(taskName: String,
                                state: VoxelyticsRunState,
                                timestamp: Instant,
                                artifacts: Map[String, WorkflowDescriptionArtifact])
    extends WorkflowEvent

case class ChunkStateChangeEvent(taskName: String,
                                 executionId: String,
                                 chunkName: String,
                                 timestamp: Instant,
                                 state: VoxelyticsRunState,
                                 payload: Option[Array[Byte]])
    extends WorkflowEvent

case class RunHeartbeatEvent(timestamp: Instant) extends WorkflowEvent

case class ChunkProfilingEvent(taskName: String,
                               executionId: String,
                               chunkName: String,
                               hostname: String,
                               pid: Long,
                               memory: Double,
                               cpuUser: Double,
                               cpuSystem: Double,
                               timestamp: Instant)
    extends WorkflowEvent

case class ArtifactFileChecksumEvent(taskName: String,
                                     artifactName: String,
                                     path: String,
                                     resolvedPath: String,
                                     checksumMethod: String,
                                     checksum: String,
                                     fileSize: Long,
                                     lastModified: Instant,
                                     timestamp: Instant)
    extends WorkflowEvent

object RunStateChangeEvent {
  implicit val jsonFormat: OFormat[RunStateChangeEvent] = Json.format[RunStateChangeEvent]
}

object TaskStateChangeEvent {
  implicit val jsonFormat: OFormat[TaskStateChangeEvent] = Json.format[TaskStateChangeEvent]
}

object ChunkStateChangeEvent {
  implicit val jsonFormat: OFormat[ChunkStateChangeEvent] = Json.format[ChunkStateChangeEvent]
}

object Base64ByteArray {
  implicit object base64ByteArrayFormat extends Format[Array[Byte]] {
    override def reads(json: JsValue): JsResult[Array[Byte]] =
      json.validate[String].map(Base64.getDecoder.decode)

    override def writes(a: Array[Byte]): JsValue =
      Json.toJson(Base64.getEncoder.encode(a))
  }
}

object RunHeartbeatEvent {
  implicit val jsonFormat: OFormat[RunHeartbeatEvent] = Json.format[RunHeartbeatEvent]
}

object ChunkProfilingEvent {
  implicit val jsonFormat: OFormat[ChunkProfilingEvent] = Json.format[ChunkProfilingEvent]
}

object ArtifactFileChecksumEvent {
  implicit val jsonFormat: OFormat[ArtifactFileChecksumEvent] = Json.format[ArtifactFileChecksumEvent]
}

object WorkflowEvent {
  implicit object workflowEventFormat extends Format[WorkflowEvent] {
    override def reads(json: JsValue): JsResult[WorkflowEvent] =
      (json \ "type").as[String] match {
        case "RUN_STATE_CHANGE"       => json.validate[RunStateChangeEvent]
        case "TASK_STATE_CHANGE"      => json.validate[TaskStateChangeEvent]
        case "CHUNK_STATE_CHANGE"     => json.validate[ChunkStateChangeEvent]
        case "RUN_HEARTBEAT"          => json.validate[RunHeartbeatEvent]
        case "CHUNK_PROFILING"        => json.validate[ChunkProfilingEvent]
        case "ARTIFACT_FILE_CHECKSUM" => json.validate[ArtifactFileChecksumEvent]
      }

    override def writes(a: WorkflowEvent): JsObject = a match {
      case s: RunStateChangeEvent =>
        Json.obj("type" -> "RUN_STATE_CHANGE") ++ Json.toJson(s)(RunStateChangeEvent.jsonFormat).as[JsObject]
      case s: TaskStateChangeEvent =>
        Json.obj("type" -> "TASK_STATE_CHANGE") ++ Json.toJson(s)(TaskStateChangeEvent.jsonFormat).as[JsObject]
      case s: ChunkStateChangeEvent =>
        Json.obj("type" -> "CHUNK_STATE_CHANGE") ++ Json.toJson(s)(ChunkStateChangeEvent.jsonFormat).as[JsObject]
      case s: RunHeartbeatEvent =>
        Json.obj("type" -> "RUN_HEARTBEAT") ++ Json.toJson(s)(RunHeartbeatEvent.jsonFormat).as[JsObject]
      case s: ChunkProfilingEvent =>
        Json.obj("type" -> "CHUNK_PROFILING") ++ Json.toJson(s)(ChunkProfilingEvent.jsonFormat).as[JsObject]
      case s: ArtifactFileChecksumEvent =>
        Json
          .obj("type" -> "ARTIFACT_FILE_CHECKSUM") ++ Json.toJson(s)(ArtifactFileChecksumEvent.jsonFormat).as[JsObject]
    }
  }
}
