package models.annotation

import java.io.File

import akka.stream.scaladsl.Source
import akka.util.ByteString
import com.scalableminds.webknossos.tracingstore.SkeletonTracing.{SkeletonTracing, SkeletonTracings}
import com.scalableminds.webknossos.tracingstore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.tracingstore.tracings.TracingSelector
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.util.tools.JsonHelper.boxFormat
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

  def getSkeletonTracing(tracingId: String): Fox[SkeletonTracing] = {
    logger.debug("Called to get SkeletonTracing." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/skeleton/${tracingId}")
      .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
      .getWithProtoResponse[SkeletonTracing](SkeletonTracing)
  }

  def getSkeletonTracings(tracingIds: List[String]): Fox[SkeletonTracings] = {
    logger.debug("Called to get multiple SkeletonTracings." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/skeleton/getMultiple")
      .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
      .postJsonWithProtoResponse[List[TracingSelector], SkeletonTracings](tracingIds.map(TracingSelector(_)))(
        SkeletonTracings)
  }

  def saveSkeletonTracing(tracing: SkeletonTracing): Fox[String] = {
    logger.debug("Called to save SkeletonTracing." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/skeleton/save")
      .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
      .postProtoWithJsonResponse[SkeletonTracing, String](tracing)
  }

  def saveSkeletonTracings(tracings: SkeletonTracings): Fox[List[Box[String]]] = {
    logger.debug("Called to save SkeletonTracings." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/skeleton/saveMultiple")
      .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
      .postProtoWithJsonResponse[SkeletonTracings, List[Box[String]]](tracings)
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

  def mergeSkeletonTracingsByIds(tracingIds: List[String], persistTracing: Boolean): Fox[String] = {
    logger.debug("Called to merge SkeletonTracings by ids." + baseInfo)
    rpc(s"${tracingStore.url}/tracings/skeleton/mergedFromIds")
      .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
      .addQueryString("persist" -> persistTracing.toString)
      .postWithJsonResponse[List[TracingSelector], String](tracingIds.map(TracingSelector(_)))
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

  def getVolumeTracing(tracingId: String): Fox[(VolumeTracing, Source[ByteString, _])] = {
    logger.debug("Called to get VolumeTracing." + baseInfo)
    for {
      tracing <- rpc(s"${tracingStore.url}/tracings/volume/${tracingId}")
        .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
        .getWithProtoResponse[VolumeTracing](VolumeTracing)
      data <- rpc(s"${tracingStore.url}/tracings/volume/${tracingId}/allData")
        .addQueryString("token" -> TracingStoreRpcClient.webKnossosToken)
        .getStream
    } yield {
      (tracing, data)
    }
  }

}
