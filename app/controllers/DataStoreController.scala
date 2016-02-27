/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import javax.inject.Inject

import org.apache.commons.io.FilenameUtils
import org.apache.commons.codec.binary.Base64
import org.apache.commons.io.FileUtils
import java.io.File
import akka.agent.Agent
import play.api.mvc.WebSocket.FrameFormatter
import play.api.http.Status
import play.api.mvc._
import play.api.libs.json.{JsError, JsSuccess, Json, JsValue}
import play.api.libs.iteratee.{Enumerator, Iteratee, Concurrent}
import scala.concurrent.{Future, Promise}
import net.liftweb.common.{Empty, Failure, Full, Box}
import play.api.libs.iteratee.Concurrent.Channel
import play.api.Logger
import play.api.libs.concurrent.Akka
import scala.concurrent.duration._
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.binary._
import play.api.i18n.{MessagesApi, I18nSupport, Messages}
import com.scalableminds.braingames.binary.models._
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.reactivemongo.{GlobalAccessContext, DBAccessContext}
import com.scalableminds.util.rest.{RESTResponse, RESTCall}
import play.api.Play

object DataStoreHandler extends DataStoreBackChannelHandler {

  lazy val config = Play.current.configuration

  def createUserDataLayer(dataStoreInfo: DataStoreInfo, base: DataSource): Fox[UserDataLayer] = {
    Logger.debug("Called to create user data source. Base: " + base.id + " Datastore: " + dataStoreInfo)
    val call = RESTCall("POST", s"/data/datasets/${base.id}/layers", Map.empty, Map.empty, Json.obj())
    sendRequest(dataStoreInfo.name, call).flatMap { response =>
      response.body.validate(UserDataLayer.userDataLayerFormat) match {
        case JsSuccess(userDataLayer, _) => Full(userDataLayer)
        case e: JsError => Failure("REST user data layer create returned malformed json: " + e.toString)
      }
    }
  }

  def requestDataLayerThumbnail(dataSet: DataSet, dataLayerName: String, width: Int, height: Int): Fox[String] = {
    Logger.debug("Thumbnail called for: " + dataSet.name + " Layer: " + dataLayerName)
    val call = RESTCall(
      "GET",
      s"/data/datasets/${dataSet.urlEncodedName}/layers/$dataLayerName/thumbnail.json",
      Map.empty,
      Map("token" -> DataTokenService.oxalisToken, "width" -> width.toString, "height" -> height.toString),
      Json.obj())

    sendRequest(dataSet.dataStoreInfo.name, call).flatMap { response =>
      (response.body \ "value").asOpt[String]
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

  def uploadDataSource(upload: DataSourceUpload) = {
    Logger.debug("Upload called for: " + upload.name)
    (for {
      localDatastore <- config.getString("datastore.name").toFox
      dataStore <- findByServer(localDatastore).toFox
      call = RESTCall("POST", s"/data/datasets/upload", Map.empty, Map.empty, Json.toJson(upload))
      response <- dataStore.request(call)
    } yield {
      (response.body \ "error").asOpt[String] match {
        case Some(error) => Failure(error)
        case _ => Full(Unit)
      }
    }).futureBox.map {
      case Full(r) => r
      case Empty => Failure("dataStore.notAvailable")
    }
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

  def sendRequest(dataStoreName: String, call: RESTCall) = {
    findByServer(dataStoreName).toFox.flatMap {
      restChannel =>
        restChannel.request(call)
    }
  }
}

object WebSocketRESTServer {
  def create() = {
    val (enumerator, channel) = Concurrent.broadcast[Array[Byte]]

    val ws = WebSocketRESTServer(channel)

    val iteratee = Iteratee.foreach[Array[Byte]] {
      it =>
        Logger.trace("Got WS message: " + it.length)
        ws.response(it)
    }.map{ _ =>
      Logger.debug("Websocket closed.")
    }
    (iteratee, enumerator, ws)
  }
}

case class WebSocketRESTServer(out: Channel[Array[Byte]]) extends FoxImplicits{
  protected implicit val system = Akka.system(play.api.Play.current)
  protected val openCalls = Agent[Map[String, Promise[Box[RESTResponse]]]](Map.empty)

  protected val RESTCallTimeout = 5 minutes

  def request(call: RESTCall)(implicit codec: Codec): Fox[RESTResponse] = {
    try{
      val promise = Promise[Box[RESTResponse]]()
      openCalls.send(_ + (call.uuid -> promise))
      Logger.trace(s"About to send WS REST call to '${call.method} ${call.path}'")
      val data: Array[Byte] = codec.encode(Json.stringify(RESTCall.restCallFormat.writes(call)))
      out.push(data)
      system.scheduler.scheduleOnce(RESTCallTimeout)(cancelRESTCall(call.uuid))
      promise.future
    } catch {
      case e: Exception =>
        Logger.error("WS exception: " + e)
        Fox.failure("WS exception. " + e.getMessage, Full(e))
    }
  }

  def cancelRESTCall(uuid: String) = {
    openCalls().get(uuid).foreach {
      promise =>
        if(promise.trySuccess(Failure("REST call timed out.")))
          Logger.warn("REST request timed out. UUID: " + uuid)
        openCalls.send(_ - uuid)
    }
  }

  def response(rawJson: Array[Byte]) = {
    try {
      val json = Json.parse(rawJson)
      json.validate[RESTResponse] match {
        case JsSuccess(response, _) =>
          if(response.status != Status.OK.toString)
            Logger.warn(s"Failed (Code: ${response.status})  REST call to '${response.path}'(${response.uuid}). Result: '${response.body.toString().take(500)}'")
          openCalls().get(response.uuid).foreach {
            promise =>
              promise.trySuccess(Full(response)) match {
                case true =>
                  Logger.trace("REST request completed. UUID: " + response.uuid)
                case false =>
                  Logger.warn("REST response was to slow. UUID: " + response.uuid)
              }
              openCalls.send(_ - response.uuid)
          }
        case _ if (json \ "ping").asOpt[String].isDefined =>
          Logger.trace("Received a ping.")
        case e: JsError =>
          Logger.warn("Invalid REST result: " + JsError.toFlatJson(e))
      }
    }catch {
      case e: Exception =>
        Logger.error("Got invalid WS message: " + e.getMessage, e)
        Logger.error(s"Message as String: '${Codec.utf_8.decode(rawJson)}'")
    }
  }
}

class DataStoreController @Inject() (val messagesApi: MessagesApi) extends Controller with DataStoreActionHelper{

  def show = DataStoreAction{ implicit request =>
    Ok(DataStore.dataStoreFormat.writes(request.dataStore))
  }

  def backChannel(name: String, key: String) = WebSocket.tryAccept[Array[Byte]] {
    implicit request =>
      Logger.info(s"Got a backchannel request for $name.")
      DataStoreDAO.findByKey(key)(GlobalAccessContext).futureBox.map {
        case Full(dataStore) =>
          val (iterator, enumerator, restChannel) = WebSocketRESTServer.create()
          DataStoreHandler.register(dataStore.name, restChannel)
          Logger.info(s"Key $name connected.")
          Right(iterator, enumerator)
        case _ =>
          Logger.warn(s"$name  tried to connect with invalid key '$key'.")
          Right(Iteratee.ignore[Array[Byte]], Enumerator.empty[Array[Byte]])
      }
  }(FrameFormatter.byteArrayFrame)

  def updateAll(name: String) = DataStoreAction(parse.json) {
    implicit request =>
      request.body.validate[List[DataSourceLike]] match {
        case JsSuccess(dataSources, _) =>
          DataSetService.updateDataSources(request.dataStore.name, dataSources)(GlobalAccessContext)
          JsonOk
        case e: JsError =>
          Logger.warn("Datastore reported invalid json for datasources.")
          JsonBadRequest(JsError.toFlatJson(e))
      }
  }

  def updateOne(name: String, dataSourceId: String) = DataStoreAction(parse.json) { implicit request =>
    request.body.validate[DataSourceLike] match {
      case JsSuccess(dataSource, _) =>
        DataSetService.updateDataSources(request.dataStore.name, List(dataSource))(GlobalAccessContext)
        JsonOk
      case e: JsError =>
        Logger.warn("Datastore reported invalid json for datasource.")
        JsonBadRequest(JsError.toFlatJson(e))
    }
  }

  def layerRead(name: String, dataSetName: String, dataLayerName: String) = DataStoreAction.async{ implicit request =>
    for{
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName)(GlobalAccessContext) ?~> Messages("dataSet.notFound")
      _ <- (dataSet.dataStoreInfo.name == request.dataStore.name) ?~> Messages("dataStore.notAllowed")
      layer <- DataSetService.getDataLayer(dataSet, dataLayerName)(GlobalAccessContext) ?~> Messages("dataLayer.notFound")
    } yield {
      Ok(Json.toJson(layer))
    }
  }

}

trait DataStoreActionHelper extends FoxImplicits with Results with I18nSupport{
  import play.api.mvc._

  class RequestWithDataStore[A](val dataStore: DataStore, request: Request[A]) extends WrappedRequest[A](request)

  object DataStoreAction extends ActionBuilder[RequestWithDataStore] {
    def invokeBlock[A](request: Request[A], block: (RequestWithDataStore[A]) => Future[Result]) = {
      request.getQueryString("key").toFox.flatMap(key => DataStoreDAO.findByKey(key)(GlobalAccessContext)).flatMap {
        dataStore =>
          block(new RequestWithDataStore(dataStore, request))
      }.getOrElse(Forbidden(Messages("dataStore.notFound")))
    }
  }
}
