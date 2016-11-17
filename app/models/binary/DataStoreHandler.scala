/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.binary

import akka.agent.Agent
import com.scalableminds.braingames.binary.models.{DataLayerHelpers, DataSource, DataSourceUpload, UserDataLayer}
import com.scalableminds.util.geometry.{BoundingBox, Point3D}
import com.scalableminds.util.rest.{RESTCall, RESTResponse}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import net.liftweb.common.{Empty, Failure, Full}
import org.apache.commons.codec.binary.Base64
import oxalis.rest.WebSocketRESTServer
import play.api.http.Status
import play.api.i18n.Messages
import play.api.libs.json.{JsError, JsSuccess, Json}
import play.api.libs.ws.{WS, WSResponse}
import play.api.mvc.Codec
import play.api.{Logger, Play}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.Play.current
import play.api.libs.Files.TemporaryFile
import play.api.libs.iteratee.Enumerator

trait DataStoreHandlingStrategy {

  def createUserDataLayer(dataStoreInfo: DataStoreInfo, base: DataSource): Fox[UserDataLayer]

  def uploadUserDataLayer(dataStoreInfo: DataStoreInfo, base: DataSource, file: TemporaryFile): Fox[UserDataLayer]

  def requestDataLayerThumbnail(dataSet: DataSet, dataLayerName: String, width: Int, height: Int): Fox[Array[Byte]]

  def progressForImport(dataSet: DataSet): Fox[RESTResponse]

  def importDataSource(dataSet: DataSet): Fox[RESTResponse]

  def uploadDataSource(upload: DataSourceUpload)(implicit messages: Messages): Fox[Boolean]
}

object DataStoreHandler extends DataStoreHandlingStrategy{
  def strategyForType(typ: DataStoreType) = typ match {
    case NDStore => NDStoreHandlingStrategy
    case WebKnossosStore => WKStoreHandlingStrategy
  }

  override def createUserDataLayer(dataStoreInfo: DataStoreInfo, base: DataSource): Fox[UserDataLayer] =
    strategyForType(dataStoreInfo.typ).createUserDataLayer(dataStoreInfo, base)

  override def uploadUserDataLayer(dataStoreInfo: DataStoreInfo, base: DataSource, file: TemporaryFile): Fox[UserDataLayer] =
    strategyForType(dataStoreInfo.typ).uploadUserDataLayer(dataStoreInfo, base, file)

  override def importDataSource(dataSet: DataSet): Fox[RESTResponse] =
    strategyForType(dataSet.dataStoreInfo.typ).importDataSource(dataSet)

  override def progressForImport(dataSet: DataSet): Fox[RESTResponse] =
    strategyForType(dataSet.dataStoreInfo.typ).progressForImport(dataSet)

  override def requestDataLayerThumbnail(dataSet: DataSet, dataLayerName: String, width: Int, height: Int): Fox[Array[Byte]] =
    strategyForType(dataSet.dataStoreInfo.typ).requestDataLayerThumbnail(dataSet, dataLayerName, width, height)

  override def uploadDataSource(upload: DataSourceUpload)(implicit messages: Messages): Fox[Boolean] =
    WKStoreHandlingStrategy.uploadDataSource(upload)
}

object NDStoreHandlingStrategy extends DataStoreHandlingStrategy with FoxImplicits{
  override def createUserDataLayer(dataStoreInfo: DataStoreInfo, base: DataSource): Fox[UserDataLayer] =
    Fox.failure("NDStore doesn't support creation of user datalayers yet.")

  override def uploadUserDataLayer(dataStoreInfo: DataStoreInfo, base: DataSource, file: TemporaryFile): Fox[UserDataLayer] =
    Fox.failure("NDStore doesn't support creation of user datalayers yet.")

  override def importDataSource(dataSet: DataSet): Fox[RESTResponse] =
    Fox.failure("NDStore doesn't support import yet.")

  override def progressForImport(dataSet: DataSet): Fox[RESTResponse] =
    Fox.failure("NDStore doesn't support import progress yet.")

  override def uploadDataSource(upload: DataSourceUpload)(implicit messages: Messages): Fox[Boolean] =
    Fox.failure("NDStore doesn't support datasource uploads yet.")

  override def requestDataLayerThumbnail(dataSet: DataSet, dataLayerName: String, width: Int, height: Int): Fox[Array[Byte]] = {
    Logger.debug("Thumbnail called for: " + dataSet.name + " Layer: " + dataLayerName)

    def extractImage(response: WSResponse)(implicit codec: Codec): Fox[Array[Byte]] = {
      Logger.error(response.toString)
      if (response.status == Status.OK) {
        Fox.successful(response.bodyAsBytes)
      } else {
        Fox.failure("ndstore.thumbnail.failed")
      }
    }

    for {
      dataLayer <- dataSet.dataSource.flatMap(ds => ds.getDataLayer(dataLayerName)).toFox
      accessToken <- dataSet.dataStoreInfo.accessToken ?~> "ndstore.accesstoken.missing"
      (x, y, z, resolution) = DataLayerHelpers.goodThumbnailParameters(dataLayer, width, height)
      imageParams = s"$resolution/$x,${x+width}/$y,${y+height}/$z,${z+1}"
      baseUrl = s"${dataSet.dataStoreInfo.url}/nd/ca"
      asd = Logger.error(s"$baseUrl/$accessToken/$dataLayerName/jpeg/$imageParams")
      response <- WS.url(s"$baseUrl/$accessToken/$dataLayerName/jpeg/$imageParams").get().toFox
      image <- extractImage(response)
    } yield image
  }
}

object WKStoreHandlingStrategy extends DataStoreHandlingStrategy with DataStoreBackChannelHandler {

  lazy val config = Play.current.configuration

  def createUserDataLayer(dataStoreInfo: DataStoreInfo, base: DataSource): Fox[UserDataLayer] = {
    Logger.debug("Called to create user data source. Base: " + base.id + " Datastore: " + dataStoreInfo)
    val call = RESTCall("POST", s"/data/datasets/${base.id}/layers", Map.empty, Map.empty, Json.obj())
    sendRequest(dataStoreInfo.name, call).flatMap { response =>
      response.body.validate(UserDataLayer.userDataLayerFormat) match {
        case JsSuccess(userDataLayer, _) => Full(userDataLayer)
        case e: JsError                  => Failure("REST user data layer create returned malformed json: " + e.toString)
      }
    }
  }

  def uploadUserDataLayer(dataStoreInfo: DataStoreInfo, base: DataSource, file: TemporaryFile): Fox[UserDataLayer] = {
    Logger.debug("Called to upload user data layer. Base: " + base.id + " Datastore: " + dataStoreInfo)

    val urlToVolumeData = s"${dataStoreInfo.url}/data/datasets/${base.id}/layers"

    val futureResponse = WS
                         .url(urlToVolumeData)
                         .withQueryString("token" -> DataTokenService.oxalisToken)
                         .post(file.file)

    futureResponse.map { response =>
      Logger.error("RESPONS CODE: " + response.status)
      Logger.error(response.body)
      response.json.validate(UserDataLayer.userDataLayerFormat) match {
        case JsSuccess(userDataLayer, _) => Full(userDataLayer)
        case e: JsError                  => Failure("REST user data layer upload returned malformed json: " + e.toString)
      }
    }
  }

  def requestDataLayerThumbnail(dataSet: DataSet, dataLayerName: String, width: Int, height: Int): Fox[Array[Byte]] = {
    Logger.debug("Thumbnail called for: " + dataSet.name + " Layer: " + dataLayerName)
    val call = RESTCall(
      "GET",
      s"/data/datasets/${dataSet.urlEncodedName}/layers/$dataLayerName/thumbnail.json",
      Map.empty,
      Map("token" -> DataTokenService.oxalisToken, "width" -> width.toString, "height" -> height.toString),
      Json.obj())

    sendRequest(dataSet.dataStoreInfo.name, call).flatMap { response =>
      (response.body \ "value").asOpt[String].map(s => Base64.decodeBase64(s))
    }
  }

  def progressForImport(dataSet: DataSet): Fox[RESTResponse] = {
    Logger.debug("Import rogress called for: " + dataSet.name)
    val call = RESTCall("GET", s"/data/datasets/${dataSet.urlEncodedName}/import", Map.empty, Map.empty, Json.obj())
    sendRequest(dataSet.dataStoreInfo.name, call)
  }

  def importDataSource(dataSet: DataSet): Fox[RESTResponse] = {
    Logger.debug("Import called for: " + dataSet.name)
    val call = RESTCall("POST", s"/data/datasets/${dataSet.urlEncodedName}/import", Map.empty, Map.empty, Json.obj())
    sendRequest(dataSet.dataStoreInfo.name, call)
  }

  def uploadDataSource(upload: DataSourceUpload)(implicit messages: Messages): Fox[Boolean] = {
    def parseResponse(response: RESTResponse) = (response.body \ "error").asOpt[String] match {
      case Some(error) => Failure(error)
      case _ => Full(true)
    }

    Logger.debug("Upload called for: " + upload.name)
    for {
      localDatastore <- config.getString("datastore.name").toFox
      dataStore <- findByServer(localDatastore).toFox
      call = RESTCall("POST", s"/data/datasets", Map.empty, Map.empty, Json.toJson(upload))
      response <- dataStore.request(call) ?~> Messages("dataStore.notAvailable")
      result <- parseResponse(response)
    } yield result
  }
}

trait DataStoreBackChannelHandler extends FoxImplicits {
  val dataStores = Agent[Map[String, WebSocketRESTServer]](Map.empty)

  def register(dataStoreName: String, restChannel: WebSocketRESTServer) = {
    dataStores.send(_ + (dataStoreName -> restChannel))
  }

  def unregister(dataStoreName: String) = {
    dataStores.send(_ - dataStoreName)
  }

  def findByServer(dataStoreName: String) = {
    dataStores().get(dataStoreName)
  }

  def sendRequest(dataStoreName: String, call: RESTCall): Fox[RESTResponse] = {
    findByServer(dataStoreName).toFox.flatMap {
      restChannel =>
        restChannel.request(call)
    }
  }
}
