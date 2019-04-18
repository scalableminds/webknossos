package models.annotation

import java.io.File

import akka.stream.scaladsl.Source
import akka.util.ByteString
import com.scalableminds.webknossos.tracingstore.SkeletonTracing.{SkeletonTracing, SkeletonTracings}
import com.scalableminds.webknossos.tracingstore.VolumeTracing.{VolumeTracing, VolumeTracings}
import com.scalableminds.webknossos.tracingstore.tracings.TracingSelector
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.util.tools.JsonHelper.boxFormat
import com.scalableminds.util.tools.JsonHelper.optionFormat
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import models.binary.{DataSet, DataStoreRpcClient}
import net.liftweb.common.Box

import scala.concurrent.ExecutionContext

object TracingStoreRpcClient {
  lazy val webKnossosToken = DataStoreRpcClient.webKnossosToken
}

class TracingStoreRpcClient(tracingStore: TracingStore, dataSet: DataSet, rpc: RPC)(implicit ec: ExecutionContext)
    extends LazyLogging {

  def baseInfo = s"Dataset: ${dataSet.name} Tracingstore: ${tracingStore.url}"

  def healthCheck = rpc(s"${tracingStore.url}/tracings/health").get

  def getSkeletonTracing(tracingId: String, version: Option[Long]): Fox[SkeletonTracing] = {
    logger.debug("Called to get SkeletonTracing." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/skeleton/${tracingId}")
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

  def duplicateSkeletonTracing(skeletonTracingId: String, versionString: Option[String] = None): Fox[String] = {
    logger.debug("Called to duplicate SkeletonTracing." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/skeleton/${skeletonTracingId}/duplicate")
      .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
      .addQueryStringOptional("version", versionString)
      .getWithJsonResponse[String]
  }

  def duplicateVolumeTracing(volumeTracingId: String): Fox[String] = {
    logger.debug("Called to duplicate VolumeTracing." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/volume/${volumeTracingId}/duplicate")
      .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
      .getWithJsonResponse[String]
  }

  def mergeSkeletonTracingsByIds(tracingIds: List[Option[String]], persistTracing: Boolean): Fox[String] = {
    logger.debug("Called to merge SkeletonTracings by ids." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/skeleton/mergedFromIds")
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

  def saveVolumeTracing(tracing: VolumeTracing, initialData: Option[File] = None): Fox[String] = {
    logger.debug("Called to create VolumeTracing." + baseInfo)
    for {
      tracingId <- rpc(s"${tracingStore.url}/tracings/volume/save")
        .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
        .postProtoWithJsonResponse[VolumeTracing, String](tracing)
      _ <- initialData match {
        case Some(file) =>
          rpc(s"${tracingStore.url}/tracings/volume/${tracingId}/initialData")
            .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
            .post(file)
        case _ =>
          Fox.successful(())
      }
    } yield {
      tracingId
    }
  }

  def getVolumeTracing(tracingId: String, version: Option[Long] = None): Fox[(VolumeTracing, Source[ByteString, _])] = {
    logger.debug("Called to get VolumeTracing." + baseInfo)
    for {
      tracing <- rpc(s"${tracingStore.url}/tracings/volume/${tracingId}")
        .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
        .addQueryStringOptional("version", version.map(_.toString))
        .getWithProtoResponse[VolumeTracing](VolumeTracing)
      data <- rpc(s"${tracingStore.url}/tracings/volume/${tracingId}/allData")
        .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
        .addQueryStringOptional("version", version.map(_.toString))
        .getStream
    } yield {
      (tracing, data)
    }
  }

  def getVolumeDataStream(tracingId: String, version: Option[Long] = None): Fox[Source[ByteString, _]] = {
    logger.debug("Called to get volume data (stream)." + baseInfo)
    for {
      data <- rpc(s"${tracingStore.url}/tracings/volume/${tracingId}/allData")
        .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
        .addQueryStringOptional("version", version.map(_.toString))
        .getStream
    } yield data
  }

  def getVolumeData(tracingId: String, version: Option[Long] = None): Fox[Array[Byte]] = {
    logger.debug("Called to get volume data." + baseInfo)
    for {
      data <- rpc(s"${tracingStore.url}/tracings/volume/${tracingId}/allDataBlocking")
        .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
        .addQueryStringOptional("version", version.map(_.toString))
        .getWithBytesResponse
    } yield data
  }

}
