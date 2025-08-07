package models.annotation

import java.io.File
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Box, Fox, FoxImplicits, JsonHelper}
import com.scalableminds.util.tools.JsonHelper.{boxFormat, optionFormat}
import com.scalableminds.webknossos.datastore.Annotation.AnnotationProto
import com.scalableminds.webknossos.datastore.SkeletonTracing.{
  SkeletonTracing,
  SkeletonTracings,
  SkeletonTracingsWithIds
}
import com.scalableminds.webknossos.datastore.VolumeTracing.{VolumeTracing, VolumeTracings}
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.annotation.{
  AnnotationLayer,
  AnnotationLayerType,
  FetchedAnnotationLayer
}
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceLike
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.tracingstore.controllers.MergedFromIdsRequest
import com.scalableminds.webknossos.tracingstore.tracings.{NamedBoundingBox, TracingSelector}
import com.scalableminds.webknossos.tracingstore.tracings.volume.MagRestrictions
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeDataZipFormat.VolumeDataZipFormat
import com.typesafe.scalalogging.LazyLogging
import controllers.RpcTokenHolder
import models.dataset.Dataset
import play.api.libs.json.JsObject

import scala.concurrent.ExecutionContext

class WKRemoteTracingStoreClient(
    tracingStore: TracingStore,
    dataset: Dataset,
    rpc: RPC,
    annotationDataSourceTemporaryStore: AnnotationDataSourceTemporaryStore)(implicit ec: ExecutionContext)
    extends LazyLogging
    with FoxImplicits {

  private def baseInfo = s" Dataset: ${dataset.name} Tracingstore: ${tracingStore.url}"

  def getSkeletonTracing(annotationId: ObjectId,
                         annotationLayer: AnnotationLayer,
                         version: Option[Long]): Fox[FetchedAnnotationLayer] = {
    logger.debug(s"Called to get SkeletonTracing $annotationId/${annotationLayer.tracingId}." + baseInfo)
    for {
      _ <- Fox.fromBool(annotationLayer.typ == AnnotationLayerType.Skeleton) ?~> "annotation.download.fetch.notSkeleton"
      skeletonTracing <- rpc(s"${tracingStore.url}/tracings/skeleton/${annotationLayer.tracingId}")
        .addQueryString("token" -> RpcTokenHolder.webknossosToken)
        .addQueryString("annotationId" -> annotationId.toString)
        .addQueryStringOptional("version", version.map(_.toString))
        .withLongTimeout
        .getWithProtoResponse[SkeletonTracing](SkeletonTracing)
      fetchedAnnotationLayer <- FetchedAnnotationLayer.fromAnnotationLayer(annotationLayer, Left(skeletonTracing))
    } yield fetchedAnnotationLayer
  }

  def getSkeletonTracings(tracingIds: List[Option[String]]): Fox[SkeletonTracings] = {
    logger.debug("Called to get multiple SkeletonTracings." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/skeleton/getMultiple")
      .addQueryString("token" -> RpcTokenHolder.webknossosToken)
      .withLongTimeout
      .postJsonWithProtoResponse[List[Option[TracingSelector]], SkeletonTracings](tracingIds.map(id =>
        id.map(TracingSelector(_))))(SkeletonTracings)
  }

  def getVolumeTracings(tracingIds: List[Option[String]]): Fox[VolumeTracings] = {
    logger.debug("Called to get multiple VolumeTracings." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/volume/getMultiple")
      .addQueryString("token" -> RpcTokenHolder.webknossosToken)
      .withLongTimeout
      .postJsonWithProtoResponse[List[Option[TracingSelector]], VolumeTracings](tracingIds.map(id =>
        id.map(TracingSelector(_))))(VolumeTracings)
  }

  def saveSkeletonTracing(tracing: SkeletonTracing, newTracingId: String): Fox[Unit] = {
    logger.debug(s"Called to save SkeletonTracing at $newTracingId." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/skeleton/save").withLongTimeout
      .addQueryString("token" -> RpcTokenHolder.webknossosToken)
      .addQueryString("newTracingId" -> newTracingId)
      .postProto[SkeletonTracing](tracing)
  }

  // Uses Box[Boolean] because Box[Unit] cannot be json-serialized. The boolean value should be ignored.
  def saveSkeletonTracings(tracings: SkeletonTracingsWithIds): Fox[List[Box[Boolean]]] = {
    logger.debug(s"Called to save ${tracings.tracings.length} SkeletonTracings." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/skeleton/saveMultiple").withLongTimeout
      .addQueryString("token" -> RpcTokenHolder.webknossosToken)
      .postProtoWithJsonResponse[SkeletonTracingsWithIds, List[Box[Boolean]]](tracings)
  }

  def saveAnnotationProto(annotationId: ObjectId, annotationProto: AnnotationProto): Fox[Unit] = {
    logger.debug(
      f"Called to save AnnotationProto $annotationId with layers ${annotationProto.annotationLayers.map(_.tracingId).mkString(",")}." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/annotation/save")
      .addQueryString("token" -> RpcTokenHolder.webknossosToken)
      .addQueryString("annotationId" -> annotationId.toString)
      .postProto[AnnotationProto](annotationProto)
  }

  def getAnnotationProto(annotationId: ObjectId, version: Option[Long]): Fox[AnnotationProto] =
    rpc(s"${tracingStore.url}/tracings/annotation/$annotationId")
      .addQueryStringOptional("version", version.map(_.toString))
      .addQueryString("token" -> RpcTokenHolder.webknossosToken)
      .getWithProtoResponse[AnnotationProto](AnnotationProto)

  // Used in duplicate route. History and version are kept
  def duplicateAnnotation(annotationId: ObjectId,
                          newAnnotationId: ObjectId,
                          ownerId: ObjectId,
                          requestingUserId: ObjectId,
                          version: Option[Long],
                          isFromTask: Boolean,
                          datasetBoundingBox: Option[BoundingBox]): Fox[AnnotationProto] = {
    logger.debug(s"Called to duplicate annotation $annotationId to new id $newAnnotationId." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/annotation/$annotationId/duplicate").withLongTimeout
      .addQueryString("token" -> RpcTokenHolder.webknossosToken)
      .addQueryString("newAnnotationId" -> newAnnotationId.toString)
      .addQueryStringOptional("version", version.map(_.toString))
      .addQueryStringOptional("datasetBoundingBox", datasetBoundingBox.map(_.toLiteral))
      .addQueryString("isFromTask" -> isFromTask.toString)
      .addQueryString("ownerId" -> ownerId.toString)
      .addQueryString("requestingUserId" -> requestingUserId.toString)
      .postEmptyWithProtoResponse[AnnotationProto]()(AnnotationProto)
  }

  // Used in task creation. History is dropped, new version will be zero.
  def duplicateSkeletonTracing(skeletonTracingId: String,
                               newAnnotationId: ObjectId,
                               newTracingId: String,
                               ownerId: ObjectId,
                               requestingUserId: ObjectId,
                               editPosition: Option[Vec3Int] = None,
                               editRotation: Option[Vec3Double] = None,
                               boundingBox: Option[BoundingBox] = None): Fox[Unit] =
    rpc(s"${tracingStore.url}/tracings/skeleton/$skeletonTracingId/duplicate").withLongTimeout
      .addQueryString("token" -> RpcTokenHolder.webknossosToken)
      .addQueryString("newAnnotationId" -> newAnnotationId.toString)
      .addQueryString("newTracingId" -> newTracingId)
      .addQueryString("ownerId" -> ownerId.toString)
      .addQueryString("requestingUserId" -> requestingUserId.toString)
      .addQueryStringOptional("editPosition", editPosition.map(_.toUriLiteral))
      .addQueryStringOptional("editRotation", editRotation.map(_.toUriLiteral))
      .addQueryStringOptional("boundingBox", boundingBox.map(_.toLiteral))
      .postEmpty()

  // Used in task creation. History is dropped, new version will be zero.
  def duplicateVolumeTracing(volumeTracingId: String,
                             newAnnotationId: ObjectId,
                             newTracingId: String,
                             ownerId: ObjectId,
                             requestingUserId: ObjectId,
                             magRestrictions: MagRestrictions = MagRestrictions.empty,
                             editPosition: Option[Vec3Int] = None,
                             editRotation: Option[Vec3Double] = None,
                             boundingBox: Option[BoundingBox] = None,
                             datasetId: ObjectId,
                             dataSource: DataSourceLike): Fox[Unit] = {
    annotationDataSourceTemporaryStore.store(newAnnotationId, dataSource, datasetId)
    rpc(s"${tracingStore.url}/tracings/volume/$volumeTracingId/duplicate").withLongTimeout
      .addQueryString("token" -> RpcTokenHolder.webknossosToken)
      .addQueryString("newAnnotationId" -> newAnnotationId.toString)
      .addQueryString("newTracingId" -> newTracingId)
      .addQueryString("ownerId" -> ownerId.toString)
      .addQueryString("requestingUserId" -> requestingUserId.toString)
      .addQueryStringOptional("editPosition", editPosition.map(_.toUriLiteral))
      .addQueryStringOptional("editRotation", editRotation.map(_.toUriLiteral))
      .addQueryStringOptional("boundingBox", boundingBox.map(_.toLiteral))
      .addQueryStringOptional("minMag", magRestrictions.minStr)
      .addQueryStringOptional("maxMag", magRestrictions.maxStr)
      .postEmpty()
  }

  def mergeAnnotationsByIds(annotationIds: List[ObjectId],
                            ownerIds: List[ObjectId],
                            newAnnotationId: ObjectId,
                            toTemporaryStore: Boolean,
                            requestingUserId: ObjectId,
                            additionalBoundingBoxes: Seq[NamedBoundingBox]): Fox[AnnotationProto] = {
    logger.debug(s"Called to merge ${annotationIds.length} annotations by ids." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/annotation/mergedFromIds").withLongTimeout
      .addQueryString("token" -> RpcTokenHolder.webknossosToken)
      .addQueryString("toTemporaryStore" -> toTemporaryStore.toString)
      .addQueryString("newAnnotationId" -> newAnnotationId.toString)
      .addQueryString("requestingUserId" -> requestingUserId.toString)
      .postJsonWithProtoResponse[MergedFromIdsRequest, AnnotationProto](
        MergedFromIdsRequest(annotationIds, ownerIds, additionalBoundingBoxes))(AnnotationProto)
  }

  def mergeSkeletonTracingsByContents(newTracingId: String, tracings: SkeletonTracings): Fox[Unit] = {
    logger.debug(
      s"Called to merge ${tracings.tracings.length} SkeletonTracings by contents into $newTracingId." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/skeleton/mergedFromContents").withLongTimeout
      .addQueryString("newTracingId" -> newTracingId)
      .addQueryString("token" -> RpcTokenHolder.webknossosToken)
      .postProto[SkeletonTracings](tracings)
  }

  def mergeVolumeTracingsByContents(newAnnotationId: ObjectId,
                                    newTracingId: String,
                                    tracings: VolumeTracings,
                                    dataSource: DataSourceLike,
                                    datasetId: ObjectId,
                                    initialData: List[Option[File]]): Fox[Unit] = {
    logger.debug(
      s"Called to merge ${tracings.tracings.length} VolumeTracings by contents into $newAnnotationId/$newTracingId." + baseInfo)
    for {
      _ <- rpc(s"${tracingStore.url}/tracings/volume/mergedFromContents")
        .addQueryString("newTracingId" -> newTracingId)
        .addQueryString("token" -> RpcTokenHolder.webknossosToken)
        .postProto[VolumeTracings](tracings)
      packedVolumeDataZips = packVolumeDataZips(initialData.flatten)
      _ = annotationDataSourceTemporaryStore.store(newAnnotationId, dataSource, datasetId)
      _ <- rpc(s"${tracingStore.url}/tracings/volume/$newTracingId/initialDataMultiple").withLongTimeout
        .addQueryString("token" -> RpcTokenHolder.webknossosToken)
        .addQueryString("annotationId" -> newAnnotationId.toString)
        .postFile(packedVolumeDataZips)
    } yield ()
  }

  private def packVolumeDataZips(files: List[File]): File =
    ZipIO.zipToTempFile(files)

  def saveVolumeTracing(annotationId: ObjectId,
                        newTracingId: String,
                        tracing: VolumeTracing,
                        initialData: Option[File] = None,
                        magRestrictions: MagRestrictions = MagRestrictions.empty,
                        dataSource: DataSourceLike,
                        datasetId: ObjectId): Fox[Unit] = {
    logger.debug(s"Called to save VolumeTracing at $newTracingId for annotation $annotationId." + baseInfo)
    annotationDataSourceTemporaryStore.store(annotationId, dataSource, datasetId)
    for {
      _ <- rpc(s"${tracingStore.url}/tracings/volume/save")
        .addQueryString("token" -> RpcTokenHolder.webknossosToken)
        .addQueryString("newTracingId" -> newTracingId)
        .postProto[VolumeTracing](tracing)
      _ <- Fox.runOptional(initialData) { initialDataFile =>
        rpc(s"${tracingStore.url}/tracings/volume/$newTracingId/initialData").withLongTimeout
          .addQueryString("token" -> RpcTokenHolder.webknossosToken)
          .addQueryString("annotationId" -> annotationId.toString)
          .addQueryStringOptional("minMag", magRestrictions.minStr)
          .addQueryStringOptional("maxMag", magRestrictions.maxStr)
          .postFile(initialDataFile)
      }
    } yield ()
  }

  def getVolumeTracing(annotationId: ObjectId,
                       annotationLayer: AnnotationLayer,
                       version: Option[Long],
                       skipVolumeData: Boolean,
                       volumeDataZipFormat: VolumeDataZipFormat,
                       voxelSize: Option[VoxelSize])(implicit ec: ExecutionContext): Fox[FetchedAnnotationLayer] = {
    logger.debug(s"Called to get VolumeTracing $annotationId/${annotationLayer.tracingId}." + baseInfo)
    for {
      _ <- Fox.fromBool(annotationLayer.typ == AnnotationLayerType.Volume) ?~> "annotation.download.fetch.notSkeleton"
      tracingId = annotationLayer.tracingId
      tracing <- rpc(s"${tracingStore.url}/tracings/volume/$tracingId")
        .addQueryString("token" -> RpcTokenHolder.webknossosToken)
        .addQueryString("annotationId" -> annotationId.toString)
        .addQueryStringOptional("version", version.map(_.toString))
        .getWithProtoResponse[VolumeTracing](VolumeTracing)
      data <- Fox.runIf(!skipVolumeData) {
        rpc(s"${tracingStore.url}/tracings/volume/$tracingId/allDataZip").withLongTimeout
          .addQueryString("token" -> RpcTokenHolder.webknossosToken)
          .addQueryString("volumeDataZipFormat" -> volumeDataZipFormat.toString)
          .addQueryString("annotationId" -> annotationId.toString)
          .addQueryStringOptional("version", version.map(_.toString))
          .addQueryStringOptional("voxelSizeFactor", voxelSize.map(_.factor.toUriLiteral))
          .addQueryStringOptional("voxelSizeUnit", voxelSize.map(_.unit.toString))
          .getWithBytesResponse
      }
      editedMappingEdgesData <- Fox.runIf(!skipVolumeData && tracing.getHasEditableMapping) {
        rpc(s"${tracingStore.url}/tracings/mapping/$tracingId/editedEdgesZip").withLongTimeout
          .addQueryString("token" -> RpcTokenHolder.webknossosToken)
          .addQueryStringOptional("version", version.map(_.toString))
          .getWithBytesResponse
      }
      baseMappingNameOpt: Option[String] <- Fox.runIf(tracing.getHasEditableMapping) {
        rpc(s"${tracingStore.url}/tracings/mapping/$tracingId/info").withLongTimeout
          .addQueryString("token" -> RpcTokenHolder.webknossosToken)
          .addQueryStringOptional("version", version.map(_.toString))
          .addQueryString("annotationId" -> annotationId.toString)
          .getWithJsonResponse[JsObject]
          .flatMap(jsObj => JsonHelper.as[String](jsObj \ "baseMappingName").toFox)
      }
      fetchedAnnotationLayer <- FetchedAnnotationLayer.fromAnnotationLayer(annotationLayer,
                                                                           Right(tracing),
                                                                           data,
                                                                           editedMappingEdgesData,
                                                                           baseMappingNameOpt)
    } yield fetchedAnnotationLayer
  }

  def getVolumeData(tracingId: String,
                    volumeDataZipFormat: VolumeDataZipFormat,
                    voxelSize: Option[VoxelSize]): Fox[Array[Byte]] = {
    logger.debug(s"Called to get volume data of $tracingId." + baseInfo)
    for {
      data <- rpc(s"${tracingStore.url}/tracings/volume/$tracingId/allDataZip").withLongTimeout
        .addQueryString("token" -> RpcTokenHolder.webknossosToken)
        .addQueryString("volumeDataZipFormat" -> volumeDataZipFormat.toString)
        .addQueryStringOptional("voxelSizeFactor", voxelSize.map(_.factor.toUriLiteral))
        .addQueryStringOptional("voxelSizeUnit", voxelSize.map(_.unit.toString))
        .getWithBytesResponse
    } yield data
  }

  def resetToBase(annotationId: ObjectId): Fox[Unit] =
    for {
      _ <- rpc(s"${tracingStore.url}/tracings/annotation/$annotationId/resetToBase").withLongTimeout
        .addQueryString("token" -> RpcTokenHolder.webknossosToken)
        .postEmpty()
    } yield ()

}
