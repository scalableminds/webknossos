/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.binary

import com.scalableminds.braingames.binary.helpers.ThumbnailHelpers
import com.scalableminds.braingames.binary.models.datasource.{DataSourceLike => DataSource}
import com.scalableminds.braingames.datastore.models.ImageThumbnail
import com.scalableminds.util.rpc.RPC
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import models.tracing.volume.VolumeTracingContent
import org.apache.commons.codec.binary.Base64
import play.api.Play.current
import play.api.http.Status
import play.api.libs.Files.TemporaryFile
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.JsObject
import play.api.libs.ws.{WS, WSResponse}
import play.api.mvc.Codec

trait DataStoreHandlingStrategy {

  def createVolumeTracing(dataStoreInfo: DataStoreInfo, base: DataSource, withFallback: Boolean): Fox[VolumeTracingContent]

  def uploadVolumeTracing(dataStoreInfo: DataStoreInfo, base: DataSource, file: TemporaryFile): Fox[VolumeTracingContent]

  def requestDataLayerThumbnail(dataSet: DataSet, dataLayerName: String, width: Int, height: Int): Fox[Array[Byte]]

  def importDataSource(dataSet: DataSet): Fox[WSResponse]
}

object DataStoreHandler extends DataStoreHandlingStrategy {

  def strategyForType(typ: DataStoreType): DataStoreHandlingStrategy = typ match {
    case NDStore         => NDStoreHandlingStrategy
    case WebKnossosStore => WKStoreHandlingStrategy
  }

  override def createVolumeTracing(dataStoreInfo: DataStoreInfo, base: DataSource, withFallback: Boolean): Fox[VolumeTracingContent] =
    strategyForType(dataStoreInfo.typ).createVolumeTracing(dataStoreInfo, base, withFallback)

  override def uploadVolumeTracing(dataStoreInfo: DataStoreInfo, base: DataSource, file: TemporaryFile): Fox[VolumeTracingContent] =
    strategyForType(dataStoreInfo.typ).uploadVolumeTracing(dataStoreInfo, base, file)

  override def importDataSource(dataSet: DataSet): Fox[WSResponse] =
    strategyForType(dataSet.dataStoreInfo.typ).importDataSource(dataSet)

  override def requestDataLayerThumbnail(dataSet: DataSet, dataLayerName: String, width: Int, height: Int): Fox[Array[Byte]] =
    strategyForType(dataSet.dataStoreInfo.typ).requestDataLayerThumbnail(dataSet, dataLayerName, width, height)
}

object NDStoreHandlingStrategy extends DataStoreHandlingStrategy with FoxImplicits with LazyLogging {

  override def createVolumeTracing(dataStoreInfo: DataStoreInfo, base: DataSource, withFallback: Boolean): Fox[VolumeTracingContent] =
    Fox.failure("NDStore doesn't support creation of VolumeTracings.")

  override def uploadVolumeTracing(dataStoreInfo: DataStoreInfo, base: DataSource, file: TemporaryFile): Fox[VolumeTracingContent] =
    Fox.failure("NDStore doesn't support creation of VolumeTracings.")

  override def importDataSource(dataSet: DataSet): Fox[WSResponse] =
    Fox.failure("NDStore doesn't support import yet.")

  override def requestDataLayerThumbnail(
    dataSet: DataSet,
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
      accessToken <- dataSet.dataStoreInfo.accessToken ?~> "ndstore.accesstoken.missing"
      thumbnail = ThumbnailHelpers.goodThumbnailParameters(dataLayer, width, height)
      resolution = (math.log(thumbnail.resolution) / math.log(2)).toInt
      imageParams = s"${resolution}/${thumbnail.x},${thumbnail.x + width}/${thumbnail.y},${thumbnail.y + height}/${thumbnail.z},${thumbnail.z + 1}"
      baseUrl = s"${dataSet.dataStoreInfo.url}/nd/ca"
      _ = logger.error(s"$baseUrl/$accessToken/$dataLayerName/jpeg/$imageParams")
      response <- WS.url(s"$baseUrl/$accessToken/$dataLayerName/jpeg/$imageParams").get().toFox
      image <- extractImage(response)
    } yield image
  }
}

object WKStoreHandlingStrategy extends DataStoreHandlingStrategy with LazyLogging {

  def createVolumeTracing(dataStoreInfo: DataStoreInfo, base: DataSource, withFallback: Boolean): Fox[VolumeTracingContent] = {
    logger.debug("Called to create VolumeTracing. Base: " + base.id + " Datastore: " + dataStoreInfo)
    RPC(s"${dataStoreInfo.url}/data/tracings/volumes")
      .withQueryString("token" -> DataTokenService.webKnossosToken)
      .withQueryString("dataSetName" -> base.id.name)
      .withQueryString("withFallback" -> withFallback.toString)
      .postWithJsonResponse[JsObject, VolumeTracingContent]()
  }

  def uploadVolumeTracing(
    dataStoreInfo: DataStoreInfo,
    base: DataSource,
    file: TemporaryFile): Fox[VolumeTracingContent] = {
    logger.debug("Called to upload VolumeTracing. Base: " + base.id + " Datastore: " + dataStoreInfo)
    RPC(s"${dataStoreInfo.url}/data/tracings/volumes")
      .withQueryString("token" -> DataTokenService.webKnossosToken)
      .withQueryString("dataSetName" -> base.id.name)
      .postWithJsonResponse[VolumeTracingContent](file.file)
  }

  def requestDataLayerThumbnail(dataSet: DataSet, dataLayerName: String, width: Int, height: Int): Fox[Array[Byte]] = {
    logger.debug("Thumbnail called for: " + dataSet.name + " Layer: " + dataLayerName)
    RPC(s"${dataSet.dataStoreInfo.url}/data/datasets/${dataSet.urlEncodedName}/layers/$dataLayerName/thumbnail.json")
      .withQueryString("token" -> DataTokenService.webKnossosToken)
      .withQueryString( "width" -> width.toString, "height" -> height.toString)
      .getWithJsonResponse[ImageThumbnail].map(thumbnail => Base64.decodeBase64(thumbnail.value))
  }

  def importDataSource(dataSet: DataSet): Fox[WSResponse] = {
    logger.debug("Import called for: " + dataSet.name)
    RPC(s"${dataSet.dataStoreInfo.url}/data/datasets/${dataSet.urlEncodedName}/import")
      .withQueryString("token" -> DataTokenService.webKnossosToken)
      .post()
  }
}
