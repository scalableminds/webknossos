package models.annotation.nml

import com.scalableminds.webknossos.tracingstore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.tracingstore.VolumeTracing.VolumeTracing
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.libs.Files.TemporaryFile

import java.io.File

object NmlResults extends LazyLogging {

  sealed trait NmlParseResult {
    def fileName: String

    def bothTracingOpts: Option[(Option[SkeletonTracing], Option[(VolumeTracing, String)])] = None

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
                             volumeTracingWithDataLocation: Option[(VolumeTracing, String)],
                             _description: String)
      extends NmlParseResult {
    def succeeded = true

    override def bothTracingOpts: Option[(Option[SkeletonTracing], Option[(VolumeTracing, String)])] =
      Some((skeletonTracing, volumeTracingWithDataLocation))

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
          case Full(success) =>
            success.volumeTracingWithDataLocation match {
              case Some((tracing, name)) => Full((tracing, otherFiles.get(name).map(_.path.toFile)))
              case None                  => Empty
            }
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
