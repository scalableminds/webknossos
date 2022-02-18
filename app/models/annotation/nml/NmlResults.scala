package models.annotation.nml

import java.io.File

import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.typesafe.scalalogging.LazyLogging
import models.annotation.UploadedVolumeLayer
import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.libs.Files.TemporaryFile

object NmlResults extends LazyLogging {

  sealed trait NmlParseResult {
    def fileName: String

    def description: Option[String] = None

    def succeeded: Boolean

    def toSuccessBox: Box[NmlParseSuccess] = this match {
      case NmlParseFailure(fileName, error) =>
        Failure(s"Couldn’t parse file: $fileName. $error")
      case success: NmlParseSuccess =>
        Full(success)
      case _ =>
        Failure(s"Couldn’t parse file: $fileName")
    }

    def withName(name: String): NmlParseResult = this
  }

  case class NmlParseSuccess(fileName: String,
                             skeletonTracing: Option[SkeletonTracing],
                             volumeLayers: List[UploadedVolumeLayer],
                             _description: String)
      extends NmlParseResult {
    def succeeded = true

    override def description: Option[String] = Some(_description)

    override def withName(name: String): NmlParseResult = this.copy(fileName = name)
  }

  case class NmlParseFailure(fileName: String, error: String) extends NmlParseResult {
    def succeeded = false
  }

  case class NmlParseEmpty(fileName: String) extends NmlParseResult {
    def succeeded = false
  }

  case class MultiNmlParseResult(parseResults: List[NmlParseResult] = Nil,
                                 otherFiles: Map[String, TemporaryFile] = Map.empty) {

    def combineWith(other: MultiNmlParseResult): MultiNmlParseResult =
      MultiNmlParseResult(parseResults ::: other.parseResults, other.otherFiles ++ otherFiles)

    def containsNoSuccesses: Boolean =
      !parseResults.exists(_.succeeded)

    def containsFailure: Boolean =
      parseResults.exists {
        case _: NmlParseFailure => true
        case _                  => false
      }

    // Used in task creation. Can only be used with single-layer volumes
    def toBoxes: List[TracingBoxContainer] =
      parseResults.map { parseResult =>
        val successBox = parseResult.toSuccessBox
        val skeletonBox = successBox match {
          case Full(success) =>
            success.skeletonTracing match {
              case Some(skeleton) => Full(skeleton)
              case None           => Empty
            }
          case f: Failure => f
          case _          => Failure("")
        }
        val volumeBox = successBox match {
          case Full(success) if success.volumeLayers.length <= 1 =>
            success.volumeLayers.headOption match {
              case Some(UploadedVolumeLayer(tracing, dataZipLocation, _)) =>
                Full((tracing, otherFiles.get(dataZipLocation).map(_.path.toFile)))
              case None => Empty
            }
          case Full(success) if success.volumeLayers.length > 1 =>
            Failure("Cannot create tasks from multi-layer volume annotations.")
          case f: Failure => f
          case _          => Failure("")
        }
        TracingBoxContainer(successBox.map(_.fileName), successBox.map(_.description), skeletonBox, volumeBox)
      }
  }

  case class TracingBoxContainer(fileName: Box[String],
                                 description: Box[Option[String]],
                                 skeleton: Box[SkeletonTracing],
                                 volume: Box[(VolumeTracing, Option[File])])

}
