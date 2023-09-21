package models.annotation

import java.io.File
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.bool2Fox
import com.scalableminds.util.tools.JsonHelper.{boxFormat, optionFormat}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonTracings}
import com.scalableminds.webknossos.datastore.VolumeTracing.{VolumeTracing, VolumeTracings}
import com.scalableminds.webknossos.datastore.models.annotation.{
  AnnotationLayer,
  AnnotationLayerType,
  FetchedAnnotationLayer
}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.tracingstore.tracings.TracingSelector
import com.scalableminds.webknossos.tracingstore.tracings.volume.ResolutionRestrictions
import com.typesafe.scalalogging.LazyLogging
import controllers.RpcTokenHolder
import models.binary.Dataset
import net.liftweb.common.Box

import scala.concurrent.ExecutionContext

class WKRemoteTracingStoreClient(tracingStore: TracingStore, dataSet: Dataset, rpc: RPC)(implicit ec: ExecutionContext)
    extends LazyLogging {

  def baseInfo = s" Dataset: ${dataSet.name} Tracingstore: ${tracingStore.url}"

  def getSkeletonTracing(annotationLayer: AnnotationLayer, version: Option[Long]): Fox[FetchedAnnotationLayer] = {
    logger.debug("Called to get SkeletonTracing." + baseInfo)
    for {
      _ <- bool2Fox(annotationLayer.typ == AnnotationLayerType.Skeleton) ?~> "annotation.download.fetch.notSkeleton"
      skeletonTracing <- rpc(s"${tracingStore.url}/tracings/skeleton/${annotationLayer.tracingId}")
        .addQueryString("token" -> RpcTokenHolder.webKnossosToken)
        .addQueryStringOptional("version", version.map(_.toString))
        .withLongTimeout
        .getWithProtoResponse[SkeletonTracing](SkeletonTracing)
      fetchedAnnotationLayer <- FetchedAnnotationLayer.fromAnnotationLayer(annotationLayer, Left(skeletonTracing))
    } yield fetchedAnnotationLayer
  }

  def getSkeletonTracings(tracingIds: List[Option[String]]): Fox[SkeletonTracings] = {
    logger.debug("Called to get multiple SkeletonTracings." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/skeleton/getMultiple")
      .addQueryString("token" -> RpcTokenHolder.webKnossosToken)
      .withLongTimeout
      .postJsonWithProtoResponse[List[Option[TracingSelector]], SkeletonTracings](tracingIds.map(id =>
        id.map(TracingSelector(_))))(SkeletonTracings)
  }

  def getVolumeTracings(tracingIds: List[Option[String]]): Fox[VolumeTracings] = {
    logger.debug("Called to get multiple VolumeTracings." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/volume/getMultiple")
      .addQueryString("token" -> RpcTokenHolder.webKnossosToken)
      .withLongTimeout
      .postJsonWithProtoResponse[List[Option[TracingSelector]], VolumeTracings](tracingIds.map(id =>
        id.map(TracingSelector(_))))(VolumeTracings)
  }

  def saveSkeletonTracing(tracing: SkeletonTracing): Fox[String] = {
    logger.debug("Called to save SkeletonTracing." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/skeleton/save").withLongTimeout
      .addQueryString("token" -> RpcTokenHolder.webKnossosToken)
      .postProtoWithJsonResponse[SkeletonTracing, String](tracing)
  }

  def saveSkeletonTracings(tracings: SkeletonTracings): Fox[List[Box[Option[String]]]] = {
    logger.debug("Called to save SkeletonTracings." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/skeleton/saveMultiple").withLongTimeout
      .addQueryString("token" -> RpcTokenHolder.webKnossosToken)
      .postProtoWithJsonResponse[SkeletonTracings, List[Box[Option[String]]]](tracings)
  }

  def saveVolumeTracings(tracings: VolumeTracings): Fox[List[Box[Option[String]]]] = {
    logger.debug("Called to save VolumeTracings." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/volume/saveMultiple").withLongTimeout
      .addQueryString("token" -> RpcTokenHolder.webKnossosToken)
      .postProtoWithJsonResponse[VolumeTracings, List[Box[Option[String]]]](tracings)
  }

  def duplicateSkeletonTracing(skeletonTracingId: String,
                               versionString: Option[String] = None,
                               isFromTask: Boolean = false,
                               editPosition: Option[Vec3Int] = None,
                               editRotation: Option[Vec3Double] = None,
                               boundingBox: Option[BoundingBox] = None): Fox[String] = {
    logger.debug("Called to duplicate SkeletonTracing." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/skeleton/$skeletonTracingId/duplicate").withLongTimeout
      .addQueryString("token" -> RpcTokenHolder.webKnossosToken)
      .addQueryStringOptional("version", versionString)
      .addQueryStringOptional("editPosition", editPosition.map(_.toUriLiteral))
      .addQueryStringOptional("editRotation", editRotation.map(_.toUriLiteral))
      .addQueryStringOptional("boundingBox", boundingBox.map(_.toLiteral))
      .addQueryString("fromTask" -> isFromTask.toString)
      .postWithJsonResponse[String]
  }

  def duplicateVolumeTracing(volumeTracingId: String,
                             isFromTask: Boolean = false,
                             dataSetBoundingBox: Option[BoundingBox] = None,
                             resolutionRestrictions: ResolutionRestrictions = ResolutionRestrictions.empty,
                             downsample: Boolean = false,
                             editPosition: Option[Vec3Int] = None,
                             editRotation: Option[Vec3Double] = None,
                             boundingBox: Option[BoundingBox] = None): Fox[String] = {
    logger.debug("Called to duplicate VolumeTracing." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/volume/$volumeTracingId/duplicate").withLongTimeout
      .addQueryString("token" -> RpcTokenHolder.webKnossosToken)
      .addQueryString("fromTask" -> isFromTask.toString)
      .addQueryStringOptional("minResolution", resolutionRestrictions.minStr)
      .addQueryStringOptional("maxResolution", resolutionRestrictions.maxStr)
      .addQueryStringOptional("editPosition", editPosition.map(_.toUriLiteral))
      .addQueryStringOptional("editRotation", editRotation.map(_.toUriLiteral))
      .addQueryStringOptional("boundingBox", boundingBox.map(_.toLiteral))
      .addQueryString("downsample" -> downsample.toString)
      .postJsonWithJsonResponse[Option[BoundingBox], String](dataSetBoundingBox)
  }

  def mergeSkeletonTracingsByIds(tracingIds: List[String], persistTracing: Boolean): Fox[String] = {
    logger.debug("Called to merge SkeletonTracings by ids." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/skeleton/mergedFromIds").withLongTimeout
      .addQueryString("token" -> RpcTokenHolder.webKnossosToken)
      .addQueryString("persist" -> persistTracing.toString)
      .postJsonWithJsonResponse[List[TracingSelector], String](tracingIds.map(TracingSelector(_)))
  }

  def mergeVolumeTracingsByIds(tracingIds: List[String], persistTracing: Boolean): Fox[String] = {
    logger.debug("Called to merge VolumeTracings by ids." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/volume/mergedFromIds").withLongTimeout
      .addQueryString("token" -> RpcTokenHolder.webKnossosToken)
      .addQueryString("persist" -> persistTracing.toString)
      .postJsonWithJsonResponse[List[TracingSelector], String](tracingIds.map(TracingSelector(_)))
  }

  def mergeSkeletonTracingsByContents(tracings: SkeletonTracings, persistTracing: Boolean): Fox[String] = {
    logger.debug("Called to merge SkeletonTracings by contents." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/skeleton/mergedFromContents").withLongTimeout
      .addQueryString("token" -> RpcTokenHolder.webKnossosToken)
      .addQueryString("persist" -> persistTracing.toString)
      .postProtoWithJsonResponse[SkeletonTracings, String](tracings)
  }

  def mergeVolumeTracingsByContents(tracings: VolumeTracings,
                                    initialData: List[Option[File]],
                                    persistTracing: Boolean): Fox[String] = {
    logger.debug("Called to merge VolumeTracings by contents." + baseInfo)
    for {
      tracingId <- rpc(s"${tracingStore.url}/tracings/volume/mergedFromContents")
        .addQueryString("token" -> RpcTokenHolder.webKnossosToken)
        .addQueryString("persist" -> persistTracing.toString)
        .postProtoWithJsonResponse[VolumeTracings, String](tracings)
      packedVolumeDataZips = packVolumeDataZips(initialData.flatten)
      _ <- rpc(s"${tracingStore.url}/tracings/volume/$tracingId/initialDataMultiple").withLongTimeout
        .addQueryString("token" -> RpcTokenHolder.webKnossosToken)
        .post(packedVolumeDataZips)
    } yield tracingId
  }

  private def packVolumeDataZips(files: List[File]): File =
    ZipIO.zipToTempFile(files)

  def saveVolumeTracing(tracing: VolumeTracing,
                        initialData: Option[File] = None,
                        resolutionRestrictions: ResolutionRestrictions = ResolutionRestrictions.empty): Fox[String] = {
    logger.debug("Called to create VolumeTracing." + baseInfo)
    for {
      tracingId <- rpc(s"${tracingStore.url}/tracings/volume/save")
        .addQueryString("token" -> RpcTokenHolder.webKnossosToken)
        .postProtoWithJsonResponse[VolumeTracing, String](tracing)
      _ <- initialData match {
        case Some(file) =>
          rpc(s"${tracingStore.url}/tracings/volume/$tracingId/initialData").withLongTimeout
            .addQueryString("token" -> RpcTokenHolder.webKnossosToken)
            .addQueryStringOptional("minResolution", resolutionRestrictions.minStr)
            .addQueryStringOptional("maxResolution", resolutionRestrictions.maxStr)
            .post(file)
        case _ =>
          Fox.successful(())
      }
    } yield tracingId
  }

  def getVolumeTracing(annotationLayer: AnnotationLayer,
                       version: Option[Long] = None,
                       skipVolumeData: Boolean): Fox[FetchedAnnotationLayer] = {
    logger.debug("Called to get VolumeTracing." + baseInfo)
    for {
      _ <- bool2Fox(annotationLayer.typ == AnnotationLayerType.Volume) ?~> "annotation.download.fetch.notSkeleton"
      tracingId = annotationLayer.tracingId
      tracing <- rpc(s"${tracingStore.url}/tracings/volume/$tracingId")
        .addQueryString("token" -> RpcTokenHolder.webKnossosToken)
        .addQueryStringOptional("version", version.map(_.toString))
        .getWithProtoResponse[VolumeTracing](VolumeTracing)
      data <- Fox.runIf(!skipVolumeData) {
        rpc(s"${tracingStore.url}/tracings/volume/$tracingId/allDataBlocking").withLongTimeout
          .addQueryString("token" -> RpcTokenHolder.webKnossosToken)
          .addQueryStringOptional("version", version.map(_.toString))
          .getWithBytesResponse
      }
      fetchedAnnotationLayer <- FetchedAnnotationLayer.fromAnnotationLayer(annotationLayer, Right(tracing), data)
    } yield fetchedAnnotationLayer
  }

  def getVolumeData(tracingId: String, version: Option[Long] = None): Fox[Array[Byte]] = {
    logger.debug("Called to get volume data." + baseInfo)
    for {
      data <- rpc(s"${tracingStore.url}/tracings/volume/$tracingId/allDataBlocking").withLongTimeout
        .addQueryString("token" -> RpcTokenHolder.webKnossosToken)
        .addQueryStringOptional("version", version.map(_.toString))
        .getWithBytesResponse
    } yield data
  }

}
