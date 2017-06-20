/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.binary

import com.scalableminds.braingames.binary.helpers.ThumbnailHelpers
import com.scalableminds.braingames.binary.models.datasource.{UserDataLayer, DataSourceLike => DataSource}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Failure, Full}
import org.apache.commons.codec.binary.Base64
import play.api.Play.current
import play.api.http.Status
import play.api.libs.Files.TemporaryFile
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsError, JsSuccess, Json}
import play.api.libs.ws.{WS, WSRequest, WSResponse}
import play.api.mvc.Codec

trait DataStoreHandlingStrategy {

  def createUserDataLayer(dataStoreInfo: DataStoreInfo, base: DataSource): Fox[UserDataLayer]

  def uploadUserDataLayer(
    dataStoreInfo: DataStoreInfo,
    base: DataSource,
    file: TemporaryFile): Fox[UserDataLayer]

  def requestDataLayerThumbnail(dataSet: DataSet, dataLayerName: String, width: Int, height: Int): Fox[Array[Byte]]

  def progressForImport(dataSet: DataSet): Fox[WSResponse]

  def importDataSource(dataSet: DataSet): Fox[WSResponse]
}

object DataStoreHandler extends DataStoreHandlingStrategy {
  def strategyForType(typ: DataStoreType): DataStoreHandlingStrategy = typ match {
    case NDStore         => NDStoreHandlingStrategy
    case WebKnossosStore => WKStoreHandlingStrategy
  }

  override def createUserDataLayer(dataStoreInfo: DataStoreInfo, base: DataSource): Fox[UserDataLayer] =
    strategyForType(dataStoreInfo.typ).createUserDataLayer(dataStoreInfo, base)

  override def uploadUserDataLayer(
    dataStoreInfo: DataStoreInfo,
    base: DataSource,
    file: TemporaryFile): Fox[UserDataLayer] =
    strategyForType(dataStoreInfo.typ).uploadUserDataLayer(dataStoreInfo, base, file)

  override def importDataSource(dataSet: DataSet): Fox[WSResponse] =
    strategyForType(dataSet.dataStoreInfo.typ).importDataSource(dataSet)

  override def progressForImport(dataSet: DataSet): Fox[WSResponse] =
    strategyForType(dataSet.dataStoreInfo.typ).progressForImport(dataSet)

  override def requestDataLayerThumbnail(dataSet: DataSet, dataLayerName: String, width: Int, height: Int): Fox[Array[Byte]] =
    strategyForType(dataSet.dataStoreInfo.typ).requestDataLayerThumbnail(dataSet, dataLayerName, width, height)
}

object NDStoreHandlingStrategy extends DataStoreHandlingStrategy with FoxImplicits with LazyLogging {
  override def createUserDataLayer(dataStoreInfo: DataStoreInfo, base: DataSource): Fox[UserDataLayer] =
    Fox.failure("NDStore doesn't support creation of user datalayers yet.")

  override def uploadUserDataLayer(
    dataStoreInfo: DataStoreInfo,
    base: DataSource,
    file: TemporaryFile): Fox[UserDataLayer] =
    Fox.failure("NDStore doesn't support creation of user datalayers yet.")

  override def importDataSource(dataSet: DataSet): Fox[WSResponse] =
    Fox.failure("NDStore doesn't support import yet.")

  override def progressForImport(dataSet: DataSet): Fox[WSResponse] =
    Fox.failure("NDStore doesn't support import progress yet.")

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
      dataLayer <- dataSet.dataSource.flatMap(ds => ds.getDataLayer(dataLayerName)).toFox
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

object WKStoreHandlingStrategy extends DataStoreHandlingStrategy with LazyLogging with FoxImplicits {

  private def dataStoreWS(dataStore: DataStoreInfo, path: String): WSRequest = {
    WS
    .url(dataStore.url + path)
    .withQueryString("token" -> DataTokenService.oxalisToken)
  }

  def createUserDataLayer(dataStoreInfo: DataStoreInfo, base: DataSource): Fox[UserDataLayer] = {
    logger.debug("Called to create user data source. Base: " + base.id + " Datastore: " + dataStoreInfo)
    dataStoreWS(dataStoreInfo, s"/data/datasets/${base.id}/layers")
    .post(Json.obj())
    .map { response =>
      response.json.validate(UserDataLayer.userDataLayerFormat) match {
        case JsSuccess(userDataLayer, _) =>
          Full(userDataLayer)
        case e: JsError                  =>
          Failure("REST user data layer create returned malformed json: " + e.toString)
      }
    }
  }

  def uploadUserDataLayer(
    dataStoreInfo: DataStoreInfo,
    base: DataSource,
    file: TemporaryFile): Fox[UserDataLayer] = {

    logger.debug("Called to upload user data layer. Base: " + base.id + " Datastore: " + dataStoreInfo)

    dataStoreWS(dataStoreInfo, s"/data/datasets/${base.id}/layers")
      .post(file.file)
      .map { response =>
      response.json.validate(UserDataLayer.userDataLayerFormat) match {
        case JsSuccess(userDataLayer, _) =>
          Full(userDataLayer)
        case e: JsError                  =>
          Failure("REST user data layer upload returned malformed json: " + e.toString)
      }
    }
  }

  def requestDataLayerThumbnail(dataSet: DataSet, dataLayerName: String, width: Int, height: Int): Fox[Array[Byte]] = {
    logger.debug("Thumbnail called for: " + dataSet.name + " Layer: " + dataLayerName)
    dataStoreWS(dataSet.dataStoreInfo, s"/data/datasets/${dataSet.urlEncodedName}/layers/$dataLayerName/thumbnail.json")
      .withQueryString( "width" -> width.toString, "height" -> height.toString)
      .get()
      .map { response =>
      (response.json \ "value").asOpt[String].map(s => Base64.decodeBase64(s))
    }
  }

  def progressForImport(dataSet: DataSet): Fox[WSResponse] = {
    logger.debug("Import rogress called for: " + dataSet.name)
    dataStoreWS(dataSet.dataStoreInfo, s"/data/datasets/${dataSet.urlEncodedName}/import")
      .get()
  }

  def importDataSource(dataSet: DataSet): Fox[WSResponse] = {
    logger.debug("Import called for: " + dataSet.name)
    dataStoreWS(dataSet.dataStoreInfo, s"/data/datasets/${dataSet.urlEncodedName}/import")
      .post("")
  }
}
