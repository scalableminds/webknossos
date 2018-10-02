package models.binary

import java.io.File

import akka.stream.scaladsl.Source
import akka.util.ByteString
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonTracings}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.models.ImageThumbnail
import com.scalableminds.webknossos.datastore.tracings.TracingSelector
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.util.tools.JsonHelper.boxFormat
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box
import org.apache.commons.codec.binary.Base64
import oxalis.security.CompactRandomIDGenerator
import play.utils.UriEncoding

import scala.concurrent.ExecutionContext

object DataStoreHandler {
  lazy val webKnossosToken = CompactRandomIDGenerator.generateBlocking(16)
}

class DataStoreHandler(dataStore: DataStore, dataSet: DataSet, rpc: RPC)(implicit ec: ExecutionContext) extends LazyLogging {

  def baseInfo = s"Dataset: ${dataSet.name} Datastore: ${dataStore.url}"

  def getSkeletonTracing(tracingId: String): Fox[SkeletonTracing] = {
    logger.debug("Called to get SkeletonTracing." + baseInfo)
    rpc(s"${dataStore.url}/data/tracings/skeleton/${tracingId}")
      .addQueryString("token" -> DataStoreHandler.webKnossosToken)
      .getWithProtoResponse[SkeletonTracing](SkeletonTracing)
  }

  def getSkeletonTracings(tracingIds: List[String]): Fox[SkeletonTracings] = {
    logger.debug("Called to get multiple SkeletonTracings." + baseInfo)
    rpc(s"${dataStore.url}/data/tracings/skeleton/getMultiple")
      .addQueryString("token" -> DataStoreHandler.webKnossosToken)
      .postJsonWithProtoResponse[List[TracingSelector], SkeletonTracings](tracingIds.map(TracingSelector(_)))(SkeletonTracings)
  }

  def saveSkeletonTracing(tracing: SkeletonTracing): Fox[String] = {
    logger.debug("Called to save SkeletonTracing." + baseInfo)
    rpc(s"${dataStore.url}/data/tracings/skeleton/save")
      .addQueryString("token" -> DataStoreHandler.webKnossosToken)
      .postProtoWithJsonResponse[SkeletonTracing, String](tracing)
  }

  def saveSkeletonTracings(tracings: SkeletonTracings): Fox[List[Box[String]]] = {
    logger.debug("Called to save SkeletonTracings." + baseInfo)
    rpc(s"${dataStore.url}/data/tracings/skeleton/saveMultiple")
      .addQueryString("token" -> DataStoreHandler.webKnossosToken)
      .postProtoWithJsonResponse[SkeletonTracings, List[Box[String]]](tracings)
  }

  def duplicateSkeletonTracing(skeletonTracingId: String, versionString: Option[String] = None): Fox[String] = {
    logger.debug("Called to duplicate SkeletonTracing." + baseInfo)
    rpc(s"${dataStore.url}/data/tracings/skeleton/${skeletonTracingId}/duplicate")
      .addQueryString("token" -> DataStoreHandler.webKnossosToken)
      .addQueryStringOptional("version", versionString)
      .getWithJsonResponse[String]
  }

  def duplicateVolumeTracing(volumeTracingId: String): Fox[String] = {
    logger.debug("Called to duplicate VolumeTracing." + baseInfo)
    rpc(s"${dataStore.url}/data/tracings/volume/${volumeTracingId}/duplicate")
      .addQueryString("token" -> DataStoreHandler.webKnossosToken)
      .getWithJsonResponse[String]
  }

  def mergeSkeletonTracingsByIds(tracingIds: List[String], persistTracing: Boolean): Fox[String] = {
    logger.debug("Called to merge SkeletonTracings by ids." + baseInfo)
    rpc(s"${dataStore.url}/data/tracings/skeleton/mergedFromIds")
      .addQueryString("token" -> DataStoreHandler.webKnossosToken)
      .addQueryString("persist" -> persistTracing.toString)
      .postWithJsonResponse[List[TracingSelector], String](tracingIds.map(TracingSelector(_)))
  }

  def mergeSkeletonTracingsByContents(tracings: SkeletonTracings, persistTracing: Boolean): Fox[String] = {
    logger.debug("Called to merge SkeletonTracings by contents." + baseInfo)
    rpc(s"${dataStore.url}/data/tracings/skeleton/mergedFromContents")
      .addQueryString("token" -> DataStoreHandler.webKnossosToken)
      .addQueryString("persist" -> persistTracing.toString)
      .postProtoWithJsonResponse[SkeletonTracings, String](tracings)
  }

  def saveVolumeTracing(tracing: VolumeTracing, initialData: Option[File] = None): Fox[String] = {
    logger.debug("Called to create VolumeTracing." + baseInfo)
    for {
      tracingId <- rpc(s"${dataStore.url}/data/tracings/volume/save")
        .addQueryString("token" -> DataStoreHandler.webKnossosToken)
        .postProtoWithJsonResponse[VolumeTracing, String](tracing)
      _ <- initialData match {
        case Some(file) =>
          rpc(s"${dataStore.url}/data/tracings/volume/${tracingId}/initialData")
            .addQueryString("token" -> DataStoreHandler.webKnossosToken)
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
      tracing <- rpc(s"${dataStore.url}/data/tracings/volume/${tracingId}")
        .addQueryString("token" -> DataStoreHandler.webKnossosToken)
        .getWithProtoResponse[VolumeTracing](VolumeTracing)
      data <- rpc(s"${dataStore.url}/data/tracings/volume/${tracingId}/data")
        .addQueryString("token" -> DataStoreHandler.webKnossosToken)
        .getStream
    } yield {
      (tracing, data)
    }
  }

  def requestDataLayerThumbnail(organizationName: String, dataLayerName: String, width: Int, height: Int, zoom: Option[Int], center: Option[Point3D]): Fox[Array[Byte]] = {
    logger.debug(s"Thumbnail called for: $organizationName-${dataSet.name} Layer: $dataLayerName")
    rpc(s"${dataStore.url}/data/datasets/${urlEncode(organizationName)}/${dataSet.urlEncodedName}/layers/$dataLayerName/thumbnail.json")
      .addQueryString("token" -> DataStoreHandler.webKnossosToken)
      .addQueryString("width" -> width.toString, "height" -> height.toString)
      .addQueryStringOptional("zoom", zoom.map(_.toString))
      .addQueryStringOptional("centerX", center.map(_.x.toString))
      .addQueryStringOptional("centerY", center.map(_.y.toString))
      .addQueryStringOptional("centerZ", center.map(_.z.toString))
      .getWithJsonResponse[ImageThumbnail].map(thumbnail => Base64.decodeBase64(thumbnail.value))
  }

  private def urlEncode(text: String) = {UriEncoding.encodePathSegment(text, "UTF-8")}

}
