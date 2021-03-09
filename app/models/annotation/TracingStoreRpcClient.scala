package models.annotation

import java.io.File

import akka.stream.scaladsl.Source
import akka.util.ByteString
import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.JsonHelper.{boxFormat, optionFormat}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonTracings}
import com.scalableminds.webknossos.datastore.VolumeTracing.{VolumeTracing, VolumeTracings}
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceLike
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.tracingstore.tracings.TracingSelector
import com.scalableminds.webknossos.tracingstore.tracings.volume.ResolutionRestrictions
import com.typesafe.scalalogging.LazyLogging
import models.binary.{DataSet, DataStoreRpcClient}
import net.liftweb.common.Box

import scala.concurrent.ExecutionContext

object TracingStoreRpcClient {
  lazy val webKnossosToken: String = DataStoreRpcClient.webKnossosToken
}

class TracingStoreRpcClient(tracingStore: TracingStore, dataSet: DataSet, rpc: RPC)(implicit ec: ExecutionContext)
    extends LazyLogging {

  def baseInfo = s"Dataset: ${dataSet.name} Tracingstore: ${tracingStore.url}"

  def getSkeletonTracing(tracingId: String, version: Option[Long]): Fox[SkeletonTracing] = {
    logger.debug("Called to get SkeletonTracing." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/skeleton/$tracingId")
      .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
      .addQueryStringOptional("version", version.map(_.toString))
      .getWithProtoResponse[SkeletonTracing](SkeletonTracing)
  }

  def getSkeletonTracings(tracingIds: List[Option[String]]): Fox[SkeletonTracings] = {
    logger.debug("Called to get multiple SkeletonTracings." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/skeleton/getMultiple")
      .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
      .postJsonWithProtoResponse[List[Option[TracingSelector]], SkeletonTracings](tracingIds.map(id =>
        id.map(TracingSelector(_))))(SkeletonTracings)
  }

  def getVolumeTracings(tracingIds: List[Option[String]]): Fox[VolumeTracings] = {
    logger.debug("Called to get multiple VolumeTracings." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/volume/getMultiple")
      .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
      .postJsonWithProtoResponse[List[Option[TracingSelector]], VolumeTracings](tracingIds.map(id =>
        id.map(TracingSelector(_))))(VolumeTracings)
  }

  def saveSkeletonTracing(tracing: SkeletonTracing): Fox[String] = {
    logger.debug("Called to save SkeletonTracing." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/skeleton/save")
      .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
      .postProtoWithJsonResponse[SkeletonTracing, String](tracing)
  }

  def saveSkeletonTracings(tracings: SkeletonTracings): Fox[List[Box[Option[String]]]] = {
    logger.debug("Called to save SkeletonTracings." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/skeleton/saveMultiple")
      .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
      .postProtoWithJsonResponse[SkeletonTracings, List[Box[Option[String]]]](tracings)
  }

  def saveVolumeTracings(tracings: VolumeTracings): Fox[List[Box[Option[String]]]] = {
    logger.debug("Called to save VolumeTracings." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/volume/saveMultiple")
      .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
      .postProtoWithJsonResponse[VolumeTracings, List[Box[Option[String]]]](tracings)
  }

  def duplicateSkeletonTracing(skeletonTracingId: String,
                               versionString: Option[String] = None,
                               fromTask: Boolean = false): Fox[String] = {
    logger.debug("Called to duplicate SkeletonTracing." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/skeleton/$skeletonTracingId/duplicate")
      .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
      .addQueryStringOptional("version", versionString)
      .addQueryString("fromTask" -> fromTask.toString)
      .getWithJsonResponse[String]
  }

  def duplicateVolumeTracing(volumeTracingId: String,
                             fromTask: Boolean = false,
                             dataSetBoundingBox: Option[BoundingBox] = None,
                             resolutionRestrictions: ResolutionRestrictions = ResolutionRestrictions.empty,
                             downsample: Boolean = false): Fox[String] = {
    logger.debug("Called to duplicate VolumeTracing." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/volume/$volumeTracingId/duplicate")
      .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
      .addQueryString("fromTask" -> fromTask.toString)
      .addQueryStringOptional("minResolution", resolutionRestrictions.minStr)
      .addQueryStringOptional("maxResolution", resolutionRestrictions.maxStr)
      .addQueryString("downsample" -> downsample.toString)
      .postWithJsonResponse[Option[BoundingBox], String](dataSetBoundingBox)
  }

  def mergeSkeletonTracingsByIds(tracingIds: List[Option[String]], persistTracing: Boolean): Fox[String] = {
    logger.debug("Called to merge SkeletonTracings by ids." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/skeleton/mergedFromIds")
      .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
      .addQueryString("persist" -> persistTracing.toString)
      .postWithJsonResponse[List[Option[TracingSelector]], String](tracingIds.map(id => id.map(TracingSelector(_))))
  }

  def mergeVolumeTracingsByIds(tracingIds: List[Option[String]], persistTracing: Boolean): Fox[String] = {
    logger.debug("Called to merge VolumeTracings by ids." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/volume/mergedFromIds")
      .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
      .addQueryString("persist" -> persistTracing.toString)
      .postWithJsonResponse[List[Option[TracingSelector]], String](tracingIds.map(id => id.map(TracingSelector(_))))
  }

  def mergeSkeletonTracingsByContents(tracings: SkeletonTracings, persistTracing: Boolean): Fox[String] = {
    logger.debug("Called to merge SkeletonTracings by contents." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/skeleton/mergedFromContents")
      .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
      .addQueryString("persist" -> persistTracing.toString)
      .postProtoWithJsonResponse[SkeletonTracings, String](tracings)
  }

  def mergeVolumeTracingsByContents(tracings: VolumeTracings,
                                    initialData: List[Option[File]],
                                    persistTracing: Boolean): Fox[String] = {
    logger.debug("Called to merge VolumeTracings by contents." + baseInfo)
    for {
      tracingId <- rpc(s"${tracingStore.url}/tracings/volume/mergedFromContents")
        .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
        .addQueryString("persist" -> persistTracing.toString)
        .postProtoWithJsonResponse[VolumeTracings, String](tracings)
      packedVolumeDataZips = packVolumeDataZips(initialData.flatten)
      _ <- rpc(s"${tracingStore.url}/tracings/volume/$tracingId/initialDataMultiple")
        .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
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
        .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
        .postProtoWithJsonResponse[VolumeTracing, String](tracing)
      _ <- initialData match {
        case Some(file) =>
          rpc(s"${tracingStore.url}/tracings/volume/$tracingId/initialData")
            .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
            .addQueryStringOptional("minResolution", resolutionRestrictions.minStr)
            .addQueryStringOptional("maxResolution", resolutionRestrictions.maxStr)
            .post(file)
        case _ =>
          Fox.successful(())
      }
    } yield tracingId
  }

  def getVolumeTracing(tracingId: String,
                       version: Option[Long] = None,
                       skipVolumeData: Boolean): Fox[(VolumeTracing, Option[Source[ByteString, _]])] = {
    logger.debug("Called to get VolumeTracing." + baseInfo)
    for {
      tracing <- rpc(s"${tracingStore.url}/tracings/volume/$tracingId")
        .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
        .addQueryStringOptional("version", version.map(_.toString))
        .getWithProtoResponse[VolumeTracing](VolumeTracing)
      data <- Fox.runIf(!skipVolumeData) {
        rpc(s"${tracingStore.url}/tracings/volume/$tracingId/allData")
          .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
          .addQueryStringOptional("version", version.map(_.toString))
          .getStream
      }
    } yield (tracing, data)
  }

  def getVolumeDataStream(tracingId: String, version: Option[Long] = None): Fox[Source[ByteString, _]] = {
    logger.debug("Called to get volume data (stream)." + baseInfo)
    for {
      data <- rpc(s"${tracingStore.url}/tracings/volume/$tracingId/allData")
        .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
        .addQueryStringOptional("version", version.map(_.toString))
        .getStream
    } yield data
  }

  def getVolumeData(tracingId: String, version: Option[Long] = None): Fox[Array[Byte]] = {
    logger.debug("Called to get volume data." + baseInfo)
    for {
      data <- rpc(s"${tracingStore.url}/tracings/volume/$tracingId/allDataBlocking")
        .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
        .addQueryStringOptional("version", version.map(_.toString))
        .getWithBytesResponse
    } yield data
  }

  def unlinkFallback(tracingId: String, dataSource: DataSourceLike): Fox[String] = {
    logger.debug(s"Called to unlink fallback segmentation for tracing $tracingId." + baseInfo)
    for {
      newId: String <- rpc(s"${tracingStore.url}/tracings/volume/$tracingId/unlinkFallback")
        .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
        .postWithJsonResponse[DataSourceLike, String](dataSource)
    } yield newId
  }

}
