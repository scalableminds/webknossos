package models.annotation.nml

import com.scalableminds.webknossos.tracingstore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.tracingstore.VolumeTracing.VolumeTracing
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.Files.TemporaryFile

import scala.concurrent.ExecutionContext

object NmlResults extends LazyLogging {

  sealed trait NmlParseResult {
    def fileName: String

    def bothTracingOpts: Option[(Option[SkeletonTracing], Option[(VolumeTracing, String)])] = None

    def description: Option[String] = None

    def organizationName: Option[String] = None

    def succeeded: Boolean

    def toSuccessFox(implicit ec: ExecutionContext): Fox[NmlParseSuccess] = this match {
      case NmlParseFailure(fileName, error) =>
        Fox.failure(s"Couldn’t parse file: $fileName. $error")
      case success: NmlParseSuccess =>
        Fox.successful(success)
      case _ =>
        Fox.failure(s"Couldn’t parse file: $fileName")
    }

    def withName(name: String): NmlParseResult = this
  }

  case class NmlParseSuccess(fileName: String,
                             skeletonTracing: Option[SkeletonTracing],
                             volumeTracingWithDataLocation: Option[(VolumeTracing, String)],
                             _description: String,
                             organizationNameOpt: Option[String])
      extends NmlParseResult {
    def succeeded = true

    override def bothTracingOpts = Some((skeletonTracing, volumeTracingWithDataLocation))

    override def description = Some(_description)

    override def organizationName: Option[String] = organizationNameOpt

    override def withName(name: String): NmlParseResult = this.copy(fileName = name)
  }

  case class NmlParseFailure(fileName: String, error: String) extends NmlParseResult {
    def succeeded = false
  }

  case class NmlParseEmpty(fileName: String) extends NmlParseResult {
    def succeeded = false
  }

  case class ZipParseResult(parseResults: List[NmlParseResult] = Nil,
                            otherFiles: Map[String, TemporaryFile] = Map.empty) {
    def combineWith(other: ZipParseResult) =
      ZipParseResult(parseResults ::: other.parseResults, other.otherFiles ++ otherFiles)

    def containsNoSuccesses =
      !parseResults.exists(_.succeeded)

    def containsFailure =
      parseResults.exists {
        case _: NmlParseFailure => true
        case _                  => false
      }
  }

}
