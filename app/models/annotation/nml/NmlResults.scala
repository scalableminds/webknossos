package models.annotation.nml

import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, Tree, TreeGroup}
import com.scalableminds.webknossos.datastore.geometry.{
  AdditionalAxisProto,
  AdditionalCoordinateProto,
  NamedBoundingBoxProto
}
import com.typesafe.scalalogging.LazyLogging
import models.annotation.UploadedVolumeLayer
import net.liftweb.common.{Box, Empty, Failure, Full}

import java.io.File

case class NmlParsedParameters(
    datasetIdOpt: Option[String],
    datasetName: String,
    organizationId: String,
    description: String,
    wkUrl: Option[String],
    volumes: Seq[NmlVolumeTag],
    editPosition: Vec3Int,
    editPositionAdditionalCoordinates: Seq[AdditionalCoordinateProto],
    editRotation: Vec3Double,
    additionalAxisProtos: Seq[AdditionalAxisProto],
    taskBoundingBox: Option[BoundingBox],
    timestamp: Long,
    zoomLevel: Double,
    userBoundingBoxes: Seq[NamedBoundingBoxProto],
    treesSplit: Seq[Tree],
    activeNodeId: Option[Int],
    treeGroupsAfterSplit: Seq[TreeGroup],
)

case class NmlParseSuccessWithoutFile(skeletonTracing: SkeletonTracing,
                                      volumeLayers: List[UploadedVolumeLayer],
                                      datasetId: ObjectId,
                                      description: String,
                                      wkUrl: Option[String])

object NmlResults extends LazyLogging {

  sealed trait NmlParseResult {
    def fileName: String

    def description: Option[String] = None
    def wkUrl: Option[String] = None

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
                             skeletonTracing: SkeletonTracing,
                             volumeLayers: List[UploadedVolumeLayer],
                             datasetId: ObjectId,
                             _description: String,
                             _wkUrl: Option[String])
      extends NmlParseResult {
    def succeeded = true

    override def description: Option[String] = Some(_description)
    override def wkUrl: Option[String] = _wkUrl

    override def withName(name: String): NmlParseResult = this.copy(fileName = name)
  }

  case class NmlParseFailure(fileName: String, error: String) extends NmlParseResult {
    def succeeded = false
  }

  case class NmlParseEmpty(fileName: String) extends NmlParseResult {
    def succeeded = false
  }

  case class MultiNmlParseResult(parseResults: List[NmlParseResult] = Nil, otherFiles: Map[String, File] = Map.empty) {

    def combineWith(other: MultiNmlParseResult): MultiNmlParseResult =
      MultiNmlParseResult(parseResults ::: other.parseResults, other.otherFiles ++ otherFiles)

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
          case Full(success) => Full(success.skeletonTracing)
          case f: Failure    => f
          case _             => Failure("")
        }
        val volumeBox = successBox match {
          case Full(success) if success.volumeLayers.length <= 1 =>
            success.volumeLayers.headOption match {
              case Some(volumeLayer) =>
                Full((volumeLayer, otherFiles.get(volumeLayer.dataZipLocation)))
              case None => Empty
            }
          case Full(success) if success.volumeLayers.length > 1 =>
            Failure("Cannot create tasks from multi-layer volume annotations.")
          case f: Failure => f
          case _          => Failure("")
        }
        TracingBoxContainer(successBox.map(_.fileName),
                            successBox.map(_.description),
                            skeletonBox,
                            volumeBox,
                            successBox.map(_.datasetId))
      }
  }

  case class TracingBoxContainer(fileName: Box[String],
                                 description: Box[Option[String]],
                                 skeleton: Box[SkeletonTracing],
                                 volume: Box[(UploadedVolumeLayer, Option[File])],
                                 datasetId: Box[ObjectId])

}
