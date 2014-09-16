/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import akka.agent.Agent
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
import play.api.i18n.Messages
import com.scalableminds.braingames.binary.models._
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.reactivemongo.{GlobalAccessContext, DBAccessContext}
import com.scalableminds.util.rest.{RESTResponse, RESTCall}

object DataStoreHandler extends DataStoreBackChannelHandler{
  def createUserDataLayer(dataStoreInfo: DataStoreInfo, base: DataSource): Fox[UserDataLayer] = {
    Logger.debug("Called to create user data source. Base: " + base.id + " Datastore: " + dataStoreInfo)
    findByServer(dataStoreInfo.name).toFox.flatMap {
      dataStore =>
        val call = RESTCall("POST", s"/data/datasets/${base.id}/layers", Map.empty, Map.empty, Json.obj())
        dataStore.request(call).flatMap { response =>
            response.body.validate(UserDataLayer.userDataLayerFormat) match {
              case JsSuccess(userDataLayer, _) => Full(userDataLayer)
              case e: JsError => Failure("REST user data layer create returned malformed json: " + e.toString)
            }
        }
    }
  }

  def requestDataLayerThumbnail(dataSet: DataSet, dataLayerName: String, width: Int, height: Int): Fox[String] = {
    Logger.debug("Thumbnail called for: " + dataSet.name + " Layer: " + dataLayerName)
    findByServer(dataSet.dataStoreInfo.name).toFox.flatMap {
      dataStore =>
        val call = RESTCall(
          "GET",
          s"/data/datasets/${dataSet.name}/layers/$dataLayerName/thumbnail.json",
          Map.empty,
          Map("token" -> DataTokenService.oxalisToken, "width" -> width.toString, "height" -> height.toString),
          Json.obj())
        dataStore.request(call).flatMap { response =>
            (response.body \ "value").asOpt[String]
        }
    }
  }

  def progressForImport(dataSet: DataSet): Fox[RESTResponse] = {
    Logger.debug("Import rogress called for: " + dataSet.name)
    findByServer(dataSet.dataStoreInfo.name).toFox.flatMap {
      dataStore =>
        val call = RESTCall("GET", s"/data/datasets/${dataSet.name}/import", Map.empty, Map.empty, Json.obj())
        dataStore.request(call)
    }
  }

  def importDataSource(dataSet: DataSet): Fox[RESTResponse] = {
    Logger.debug("Import called for: " + dataSet.name)
    findByServer(dataSet.dataStoreInfo.name).toFox.flatMap {
      dataStore =>
        val call = RESTCall("POST", s"/data/datasets/${dataSet.name}/import", Map.empty, Map.empty, Json.obj())
        dataStore.request(call)
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
        Logger.trace("Got WS message: " + it.size)
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
      Logger.debug(s"About to send WS REST call to '${call.method} ${call.path}'")
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
    openCalls().get(uuid).map {
      promise =>
        promise.trySuccess(Failure("REST call timed out.")) match {
          case true =>
            Logger.warn("REST request timed out. UUID: " + uuid)
          case false =>
            Logger.debug("REST request couldn't get completed. UUID: " + uuid)
        }
    }
  }

  def response(rawJson: Array[Byte]) = {
    try {
      val json = Json.parse(rawJson)
      json.validate[RESTResponse] match {
        case JsSuccess(response, _) =>
          Logger.debug("Finished with REST result: " + response)
          openCalls().get(response.uuid).map {
            promise =>
              promise.trySuccess(Full(response)) match {
                case true =>
                  Logger.debug("REST request completed. UUID: " + response.uuid)
                case false =>
                  Logger.warn("REST request timed out. UUID: " + response.uuid)
              }
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

object DataStoreController extends Controller with DataStoreActionHelper{

  def show = DataStoreAction{ implicit request =>
    Ok(DataStore.dataStoreFormat.writes(request.dataStore))
  }

  def backChannel(name: String, key: String) = WebSocket.async[Array[Byte]] {
    implicit request =>
      Logger.debug(s"Got a backchannel request for $name.")
      DataStoreDAO.findByKey(key)(GlobalAccessContext).futureBox.map {
        case Full(dataStore) =>
          val (iterator, enumerator, restChannel) = WebSocketRESTServer.create
          DataStoreHandler.register(dataStore.name, restChannel)
          Logger.debug(s"Key $name connected.")
          (iterator, enumerator)
        case _ =>
          Logger.warn(s"$name  tried to connect with invalid key '$key'.")
          (Iteratee.ignore[Array[Byte]], Enumerator.empty[Array[Byte]])
      }
  }

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

  def updateOne(name: String, dataSourceId: String) = DataStoreAction(parse.json) {
    implicit request =>
      request.body.validate[DataSourceLike] match {
        case JsSuccess(dataSource, _) =>
          DataSetService.updateDataSources(request.dataStore.name, List(dataSource))(GlobalAccessContext)
          JsonOk
        case e: JsError =>
          Logger.warn("Datastore reported invalid json for datasource.")
          JsonBadRequest(JsError.toFlatJson(e))
      }
  }

  def ensureDataStoreHasAccess(dataStore: DataStore, dataSet: DataSet): Fox[Boolean] = {
    if(dataSet.dataStoreInfo.name == dataStore.name)
      Full(true)
    else
      Failure(Messages("dataStore.notAllowed"))
  }

  def getDataLayer(dataSet: DataSet, dataLayerName: String)(implicit ctx: DBAccessContext): Fox[DataLayer] = {
    dataSet
      .dataSource.flatMap(_.getDataLayer(dataLayerName)).toFox
      .orElse(UserDataLayerDAO.findOneByName(dataLayerName).filter(_.dataSourceName == dataSet.name).map(_.dataLayer))
  }

  def layerRead(name: String, dataSetName: String, dataLayerName: String) = DataStoreAction.async{ implicit request =>
    for{
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName)(GlobalAccessContext) ?~> Messages("dataSet.notFound")
      _ <- ensureDataStoreHasAccess(request.dataStore, dataSet)
      layer <- getDataLayer(dataSet, dataLayerName)(GlobalAccessContext) ?~> Messages("dataLayer.notFound")
    } yield {
      Ok(Json.toJson(layer))
    }
  }

}

trait DataStoreActionHelper extends FoxImplicits with Results{
  import play.api.mvc._

  class RequestWithDataStore[A](val dataStore: DataStore, request: Request[A]) extends WrappedRequest[A](request)

  object DataStoreAction extends ActionBuilder[RequestWithDataStore] {
    def invokeBlock[A](request: Request[A], block: (RequestWithDataStore[A]) => Future[SimpleResult]) = {
      request.getQueryString("key").toFox.flatMap(key => DataStoreDAO.findByKey(key)(GlobalAccessContext)).flatMap {
        dataStore =>
          block(new RequestWithDataStore(dataStore, request))
      }.getOrElse(Forbidden(Messages("dataStore.notFound")))
    }
  }
}
