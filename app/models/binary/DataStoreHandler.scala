/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.binary

import java.io.File

import com.scalableminds.braingames.binary.helpers.ThumbnailHelpers
import com.scalableminds.braingames.datastore.SkeletonTracing.{SkeletonTracing, SkeletonTracings}
import com.scalableminds.braingames.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.braingames.datastore.models.ImageThumbnail
import com.scalableminds.braingames.datastore.tracings.{TracingReference, TracingSelector}
import com.scalableminds.util.rpc.RPC
import com.scalableminds.util.tools.JsonHelper.boxFormat
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box
import org.apache.commons.codec.binary.Base64
import play.api.Play.current
import play.api.http.Status
import play.api.libs.Files.TemporaryFile
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.iteratee.Enumerator
import play.api.libs.ws.{WS, WSResponse}
import play.api.mvc.Codec

trait DataStoreHandlingStrategy {

  def getSkeletonTracing(reference: TracingReference): Fox[SkeletonTracing] =
    Fox.failure("DataStore doesn't support getting SkeletonTracings")

  def getSkeletonTracings(references: List[TracingReference]): Fox[SkeletonTracings] =
    Fox.failure("DataStore doesn't support getting SkeletonTracings")

  def saveSkeletonTracing(tracing: SkeletonTracing): Fox[TracingReference] =
    Fox.failure("DataStore doesn't support saving SkeletonTracings.")

  def saveSkeletonTracings(tracings: SkeletonTracings): Fox[List[Box[TracingReference]]] =
    Fox.failure("DataStore doesn't support saving SkeletonTracings.")

  def duplicateSkeletonTracing(tracingReference: TracingReference, versionString: Option[String] = None): Fox[TracingReference] =
    Fox.failure("DatStore doesn't support duplication of SkeletonTracings.")

  def mergeSkeletonTracingsByIds(tracingSelectors: List[TracingReference], persistTracing: Boolean): Fox[TracingReference] =
    Fox.failure("DataStore does't support merging of SkeletonTracings by ids.")

  def mergeSkeletonTracingsByContents(tracings: SkeletonTracings, persistTracing: Boolean): Fox[TracingReference] =
    Fox.failure("DataStore does't support merging of SkeletonTracings by contents.")

  def saveVolumeTracing(tracing: VolumeTracing, initialData: Option[File] = None): Fox[TracingReference] =
    Fox.failure("DataStore doesn't support creation of VolumeTracings.")

  def getVolumeTracing(reference: TracingReference): Fox[(VolumeTracing, Enumerator[Array[Byte]])] =
    Fox.failure("DataStore doesn't support getting VolumeTracings")

  def requestDataLayerThumbnail(dataLayerName: String, width: Int, height: Int): Fox[Array[Byte]] =
    Fox.failure("DataStore doesn't support thumbnail creation.")

  def importDataSource: Fox[WSResponse] =
    Fox.failure("DataStore doesn't support dataSource import.")
}

object DataStoreHandlingStrategy {

  def apply(dataSet: DataSet): DataStoreHandlingStrategy = dataSet.dataStoreInfo.typ match {
    case WebKnossosStore =>
      new WKStoreHandlingStrategy(dataSet.dataStoreInfo, dataSet)
    case NDStore =>
      new NDStoreHandlingStrategy(dataSet.dataStoreInfo, dataSet)
  }
}

class WKStoreHandlingStrategy(dataStoreInfo: DataStoreInfo, dataSet: DataSet) extends DataStoreHandlingStrategy with LazyLogging {

  val webKnossosToken = play.api.Play.current.configuration.getString("application.authentication.dataStoreToken").getOrElse("somethingSecure")

  override def getSkeletonTracing(reference: TracingReference): Fox[SkeletonTracing] = {
    logger.debug("Called to get SkeletonTracing. Base: " + dataSet.name + " Datastore: " + dataStoreInfo)
    RPC(s"${dataStoreInfo.url}/data/tracings/skeleton/${reference.id}/getProto")
      .withQueryString("token" -> webKnossosToken)
      .getWithProtoResponse[SkeletonTracing](SkeletonTracing)
  }

  override def getSkeletonTracings(references: List[TracingReference]): Fox[SkeletonTracings] = {
    logger.debug("Called to get multiple SkeletonTracings. Base: " + dataSet.name + " Datastore: " + dataStoreInfo)
    RPC(s"${dataStoreInfo.url}/data/tracings/skeleton/getMultiple")
      .withQueryString("token" -> webKnossosToken)
      .postJsonWithProtoResponse[List[TracingSelector], SkeletonTracings](references.map(r => TracingSelector(r.id)))(SkeletonTracings)
  }

  override def saveSkeletonTracing(tracing: SkeletonTracing): Fox[TracingReference] = {
    logger.debug("Called to save SkeletonTracing. Base: " + dataSet.name + " Datastore: " + dataStoreInfo)
    RPC(s"${dataStoreInfo.url}/data/tracings/skeleton/save")
      .withQueryString("token" -> webKnossosToken)
      .postProtoWithJsonResponse[SkeletonTracing, TracingReference](tracing)
  }

  override def saveSkeletonTracings(tracings: SkeletonTracings): Fox[List[Box[TracingReference]]] = {
    logger.debug("Called to save SkeletonTracings. Base: " + dataSet.name + " Datastore: " + dataStoreInfo)
    RPC(s"${dataStoreInfo.url}/data/tracings/skeleton/saveMultiple")
      .withQueryString("token" -> webKnossosToken)
      .postProtoWithJsonResponse[SkeletonTracings, List[Box[TracingReference]]](tracings)
  }

  override def duplicateSkeletonTracing(tracingReference: TracingReference, versionString: Option[String] = None): Fox[TracingReference] = {
    logger.debug("Called to duplicate SkeletonTracing. Base: " + dataSet.name + " Datastore: " + dataStoreInfo)
    RPC(s"${dataStoreInfo.url}/data/tracings/skeleton/${tracingReference.id}/duplicate")
      .withQueryString("token" -> webKnossosToken)
      .withQueryStringOptional("version", versionString)
      .getWithJsonResponse[TracingReference]
  }

  override def mergeSkeletonTracingsByIds(references: List[TracingReference], persistTracing: Boolean): Fox[TracingReference] = {
    logger.debug("Called to merge SkeletonTracings by ids. Base: " + dataSet.name + " Datastore: " + dataStoreInfo)
    RPC(s"${dataStoreInfo.url}/data/tracings/skeleton/mergedFromIds")
      .withQueryString("token" -> webKnossosToken)
      .withQueryString("persist" -> persistTracing.toString)
      .postWithJsonResponse[List[TracingSelector], TracingReference](references.map(r => TracingSelector(r.id)))
  }

  override def mergeSkeletonTracingsByContents(tracings: SkeletonTracings, persistTracing: Boolean): Fox[TracingReference] = {
    logger.debug("Called to merge SkeletonTracings by contents. Base: " + dataSet.name + " Datastore: " + dataStoreInfo)
    RPC(s"${dataStoreInfo.url}/data/tracings/skeleton/mergedFromContents")
      .withQueryString("token" -> webKnossosToken)
      .withQueryString("persist" -> persistTracing.toString)
      .postProtoWithJsonResponse[SkeletonTracings, TracingReference](tracings)
  }

  override def saveVolumeTracing(tracing: VolumeTracing, initialData: Option[File]): Fox[TracingReference] = {
    logger.debug("Called to create VolumeTracing. Base: " + dataSet.name + " Datastore: " + dataStoreInfo)
    for {
      tracingReference <- RPC(s"${dataStoreInfo.url}/data/tracings/volume/save")
        .withQueryString("token" -> webKnossosToken)
        .postProtoWithJsonResponse[VolumeTracing, TracingReference](tracing)
      _ <- initialData match {
        case Some(file) =>
          RPC(s"${dataStoreInfo.url}/data/tracings/volume/${tracingReference.id}/initialData")
            .withQueryString("token" -> webKnossosToken)
            .post(file)
        case _ =>
          Fox.successful(())
      }
    } yield {
      tracingReference
    }
  }

  override def getVolumeTracing(reference: TracingReference): Fox[(VolumeTracing, Enumerator[Array[Byte]])] = {
    logger.debug("Called to get VolumeTracing. Base: " + dataSet.name + " Datastore: " + dataStoreInfo)
    for {
      tracing <- RPC(s"${dataStoreInfo.url}/data/tracings/volume/${reference.id}/getProto")
        .withQueryString("token" -> webKnossosToken)
        .getWithProtoResponse[VolumeTracing](VolumeTracing)
      data <- RPC(s"${dataStoreInfo.url}/data/tracings/volume/${reference.id}/data")
        .withQueryString("token" -> webKnossosToken)
        .getStream.map(_._2)
    } yield {
      (tracing, data)
    }
  }

  override def requestDataLayerThumbnail(dataLayerName: String, width: Int, height: Int): Fox[Array[Byte]] = {
    logger.debug("Thumbnail called for: " + dataSet.name + " Layer: " + dataLayerName)
    RPC(s"${dataStoreInfo.url}/data/datasets/${dataSet.urlEncodedName}/layers/$dataLayerName/thumbnail.json")
      .withQueryString("token" -> webKnossosToken)
      .withQueryString( "width" -> width.toString, "height" -> height.toString)
      .getWithJsonResponse[ImageThumbnail].map(thumbnail => Base64.decodeBase64(thumbnail.value))
  }

  override def importDataSource: Fox[WSResponse] = {
    logger.debug("Import called for: " + dataSet.name)
    RPC(s"${dataStoreInfo.url}/data/datasets/${dataSet.urlEncodedName}/import")
      .withQueryString("token" -> webKnossosToken)
      .post()
  }
}

class NDStoreHandlingStrategy(dataStoreInfo: DataStoreInfo, dataSet: DataSet) extends DataStoreHandlingStrategy with FoxImplicits with LazyLogging {

  override def requestDataLayerThumbnail(
    dataLayerName: String,
    width: Int,
    height: Int): Fox[Array[Byte]] = {

    logger.debug("Thumbnail called for: " + dataSet.name + " Layer: " + dataLayerName)

    def extractImage(response: WSResponse)(implicit codec: Codec): Fox[Array[Byte]] = {
      logger.error(response.toString)
      if (response.status == Status.OK) {
        Fox.successful(response.bodyAsBytes)
      } else {
        Fox.failure("ndstore.thumbnail.failed")
      }
    }

    for {
      dataLayer <- dataSet.dataSource.toUsable.flatMap(ds => ds.getDataLayer(dataLayerName)).toFox
      accessToken <- dataStoreInfo.accessToken ?~> "ndstore.accesstoken.missing"
      thumbnail = ThumbnailHelpers.goodThumbnailParameters(dataLayer, width, height)
      resolution = (math.log(thumbnail.resolution) / math.log(2)).toInt
      imageParams = s"${resolution}/${thumbnail.x},${thumbnail.x + width}/${thumbnail.y},${thumbnail.y + height}/${thumbnail.z},${thumbnail.z + 1}"
      baseUrl = s"${dataStoreInfo.url}/nd/ca"
      _ = logger.error(s"$baseUrl/$accessToken/$dataLayerName/jpeg/$imageParams")
      response <- WS.url(s"$baseUrl/$accessToken/$dataLayerName/jpeg/$imageParams").get().toFox
      image <- extractImage(response)
    } yield image
  }
}
