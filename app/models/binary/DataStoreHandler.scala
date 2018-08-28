package models.binary

import java.io.File
import java.math.BigInteger
import java.security.SecureRandom

import akka.stream.scaladsl.Source
import akka.util.ByteString
import com.mohiva.play.silhouette.api.util.IDGenerator
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonTracings}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.models.ImageThumbnail
import com.scalableminds.webknossos.datastore.tracings.TracingSelector
import com.scalableminds.util.rpc.RPC
import com.scalableminds.util.tools.JsonHelper.boxFormat
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box
import org.apache.commons.codec.binary.Base64
import oxalis.security.CompactRandomIDGenerator
import play.api.Play.current
import play.api.http.Status
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.iteratee.Enumerator
import play.api.libs.ws.{WS, WSResponse}
import play.api.mvc.Codec

object DataStoreHandler {
  lazy val webKnossosToken = new CompactRandomIDGenerator().generateBlocking
}

class DataStoreHandler(dataStore: DataStore, dataSet: DataSet) extends LazyLogging {

  def baseInfo = s"Dataset: ${dataSet.name} Datastore: ${dataStore.url}"

  def getSkeletonTracing(tracingId: String): Fox[SkeletonTracing] = {
    logger.debug("Called to get SkeletonTracing." + baseInfo)
    RPC(s"${dataStore.url}/data/tracings/skeleton/${tracingId}")
      .withQueryString("token" -> DataStoreHandler.webKnossosToken)
      .getWithProtoResponse[SkeletonTracing](SkeletonTracing)
  }

  def getSkeletonTracings(tracingIds: List[String]): Fox[SkeletonTracings] = {
    logger.debug("Called to get multiple SkeletonTracings." + baseInfo)
    RPC(s"${dataStore.url}/data/tracings/skeleton/getMultiple")
      .withQueryString("token" -> DataStoreHandler.webKnossosToken)
      .postJsonWithProtoResponse[List[TracingSelector], SkeletonTracings](tracingIds.map(TracingSelector(_)))(SkeletonTracings)
  }

  def saveSkeletonTracing(tracing: SkeletonTracing): Fox[String] = {
    logger.debug("Called to save SkeletonTracing." + baseInfo)
    RPC(s"${dataStore.url}/data/tracings/skeleton/save")
      .withQueryString("token" -> DataStoreHandler.webKnossosToken)
      .postProtoWithJsonResponse[SkeletonTracing, String](tracing)
  }

  def saveSkeletonTracings(tracings: SkeletonTracings): Fox[List[Box[String]]] = {
    logger.debug("Called to save SkeletonTracings." + baseInfo)
    RPC(s"${dataStore.url}/data/tracings/skeleton/saveMultiple")
      .withQueryString("token" -> DataStoreHandler.webKnossosToken)
      .postProtoWithJsonResponse[SkeletonTracings, List[Box[String]]](tracings)
  }

  def duplicateSkeletonTracing(skeletonTracingId: String, versionString: Option[String] = None): Fox[String] = {
    logger.debug("Called to duplicate SkeletonTracing." + baseInfo)
    RPC(s"${dataStore.url}/data/tracings/skeleton/${skeletonTracingId}/duplicate")
      .withQueryString("token" -> DataStoreHandler.webKnossosToken)
      .withQueryStringOptional("version", versionString)
      .getWithJsonResponse[String]
  }

  def duplicateVolumeTracing(volumeTracingId: String): Fox[String] = {
    logger.debug("Called to duplicate VolumeTracing." + baseInfo)
    RPC(s"${dataStore.url}/data/tracings/volume/${volumeTracingId}/duplicate")
      .withQueryString("token" -> DataStoreHandler.webKnossosToken)
      .getWithJsonResponse[String]
  }

  def mergeSkeletonTracingsByIds(tracingIds: List[String], persistTracing: Boolean): Fox[String] = {
    logger.debug("Called to merge SkeletonTracings by ids." + baseInfo)
    RPC(s"${dataStore.url}/data/tracings/skeleton/mergedFromIds")
      .withQueryString("token" -> DataStoreHandler.webKnossosToken)
      .withQueryString("persist" -> persistTracing.toString)
      .postWithJsonResponse[List[TracingSelector], String](tracingIds.map(TracingSelector(_)))
  }

  def mergeSkeletonTracingsByContents(tracings: SkeletonTracings, persistTracing: Boolean): Fox[String] = {
    logger.debug("Called to merge SkeletonTracings by contents." + baseInfo)
    RPC(s"${dataStore.url}/data/tracings/skeleton/mergedFromContents")
      .withQueryString("token" -> DataStoreHandler.webKnossosToken)
      .withQueryString("persist" -> persistTracing.toString)
      .postProtoWithJsonResponse[SkeletonTracings, String](tracings)
  }

  def saveVolumeTracing(tracing: VolumeTracing, initialData: Option[File] = None): Fox[String] = {
    logger.debug("Called to create VolumeTracing." + baseInfo)
    for {
      tracingId <- RPC(s"${dataStore.url}/data/tracings/volume/save")
        .withQueryString("token" -> DataStoreHandler.webKnossosToken)
        .postProtoWithJsonResponse[VolumeTracing, String](tracing)
      _ <- initialData match {
        case Some(file) =>
          RPC(s"${dataStore.url}/data/tracings/volume/${tracingId}/initialData")
            .withQueryString("token" -> DataStoreHandler.webKnossosToken)
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
      tracing <- RPC(s"${dataStore.url}/data/tracings/volume/${tracingId}")
        .withQueryString("token" -> DataStoreHandler.webKnossosToken)
        .getWithProtoResponse[VolumeTracing](VolumeTracing)
      data <- RPC(s"${dataStore.url}/data/tracings/volume/${tracingId}/data")
        .withQueryString("token" -> DataStoreHandler.webKnossosToken)
        .getStream
    } yield {
      (tracing, data)
    }
  }

  def requestDataLayerThumbnail(dataLayerName: String, width: Int, height: Int, zoom: Option[Int], center: Option[Point3D]): Fox[Array[Byte]] = {
    logger.debug("Thumbnail called for: " + dataSet.name + " Layer: " + dataLayerName)
    RPC(s"${dataStore.url}/data/datasets/${dataSet.urlEncodedName}/layers/$dataLayerName/thumbnail.json")
      .withQueryString("token" -> DataStoreHandler.webKnossosToken)
      .withQueryString( "width" -> width.toString, "height" -> height.toString)
      .withQueryStringOptional("zoom", zoom.map(_.toString))
      .withQueryStringOptional("centerX", center.map(_.x.toString))
      .withQueryStringOptional("centerY", center.map(_.y.toString))
      .withQueryStringOptional("centerZ", center.map(_.z.toString))
      .getWithJsonResponse[ImageThumbnail].map(thumbnail => Base64.decodeBase64(thumbnail.value))
  }

  def importDataSource: Fox[WSResponse] = {
    logger.debug("Import called for: " + dataSet.name)
    RPC(s"${dataStore.url}/data/datasets/${dataSet.urlEncodedName}/import")
      .withQueryString("token" -> DataStoreHandler.webKnossosToken)
      .post()
  }
}
