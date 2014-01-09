package controllers

import play.api._
import play.api.mvc.{SimpleResult, WebSocket, AsyncResult}
import play.api.Play.current
import play.api.libs.iteratee._
import Input.EOF
import play.api.libs.concurrent._
import play.api.libs.json.JsValue
import play.libs.Akka._
import _root_.models.security.{RoleDAO, Role}
import models.binary._
import oxalis.security.{UserAwareRequest, AuthenticatedRequest, Secured}
import scala.concurrent.Future
import braingames.geometry.Point3D
import akka.pattern.AskTimeoutException
import play.api.libs.iteratee.Concurrent.Channel
import scala.collection.mutable.ArrayBuffer
import akka.routing.RoundRobinRouter
import scala.concurrent.Future
import play.api.i18n.Messages
import braingames.image._
import java.awt.image.BufferedImage
import braingames.image.JPEGWriter
import braingames.binary.models._
import braingames.binary._
import oxalis.binary.BinaryDataService
import net.liftweb.common._
import braingames.util.ExtendedTypes.ExtendedFutureBox
import braingames.util.ExtendedTypes.ExtendedArraySeq
import braingames.binary.ParsedRequest
import oxalis.security.AuthenticatedRequest
import scala.Some
import braingames.binary.DataRequestSettings
import braingames.image.ImageCreatorParameters
import braingames.binary.ParsedRequestCollection
import braingames.reactivemongo.DBAccessContext
import braingames.util.Fox

object BinaryData extends Controller with Secured {
  override val DefaultAccessRole = RoleDAO.User

  val conf = Play.configuration

  implicit val dispatcher = Akka.system.dispatcher
  val scaleFactors = Array(1, 1, 1)

  def createDataRequestCollection(dataSet: DataSet, dataLayer: DataLayer, cubeSize: Int, parsedRequest: ParsedRequestCollection) = {
    val dataRequests = parsedRequest.requests.map(r =>
      BinaryDataService.createDataRequest(dataSet, dataLayer, None, cubeSize, r))
    DataRequestCollection(dataRequests)
  }

  def requestData(
                   dataSetName: String,
                   dataLayerTyp: String,
                   cubeSize: Int,
                   parsedRequest: ParsedRequestCollection
                 )(implicit ctx: DBAccessContext): Fox[Array[Byte]] = {
    for {
      dataSet <- DataSetDAO.findOneByName(dataSetName) ?~> Messages("dataSet.notFound")
      dataLayer <- dataSet.dataLayer(dataLayerTyp) ?~> Messages("dataLayer.notFound")
      dataRequestCollection = createDataRequestCollection(dataSet, dataLayer, cubeSize, parsedRequest)
      data <- BinaryDataService.handleDataRequest(dataRequestCollection) ?~> "Data request couldn't get handled"
    } yield {
      data
    }
  }

  def requestData(
                   dataSetName: String,
                   dataLayerType: String,
                   position: Point3D,
                   width: Int,
                   height: Int,
                   depth: Int,
                   resolutionExponent: Int,
                   settings: DataRequestSettings
                 )(implicit ctx: DBAccessContext): Fox[Array[Byte]] = {
    for {
      dataSet <- DataSetDAO.findOneByName(dataSetName) ?~> Messages("dataSet.notFound")
      dataLayer <- dataSet.dataLayer(dataLayerTyp) ?~> Messages("dataLayer.notFound")

      dataRequestCollection = BinaryDataService.createDataRequest(
        dataSet,
        dataLayer,
        None,
        width,
        height,
        depth,
        position,
        resolutionExponent,
        settings)
      data <- BinaryDataService.handleDataRequest(dataRequestCollection) ?~> "Data request couldn't get handled"
    } yield {
      data
    }
  }

  def requestViaAjaxDebug(dataSetName: String, dataLayerTyp: String, cubeSize: Int, x: Int, y: Int, z: Int, resolution: Int) = Authenticated().async {
    implicit request =>
      val dataRequests = ParsedRequestCollection(Array(ParsedRequest(resolution, Point3D(x, y, z), false)))
      for {
        data <- requestData(dataSetName, dataLayerTyp, cubeSize, dataRequests)
      } yield {
        Ok(data)
      }
  }

  /**
   * Handles a request for binary data via a HTTP POST. The content of the
   * POST body is specified in the BinaryProtokoll.parseAjax functions.
   */

  def requestViaAjax(dataSetName: String, dataLayerTyp: String, cubeSize: Int) = UserAwareAction.async(parse.raw) {
    implicit request =>
      for {
        payload <- request.body.asBytes() ?~> Messages("binary.payload.notSupplied")
        requests <- BinaryProtocol.parse(payload, containsHandle = false) ?~> Messages("binary.payload.invalid")
        data <- requestData(dataSetName, dataLayerTyp, cubeSize, requests) ?~> Messages("binary.data.notFound")
      } yield {
        Ok(data)
      }
  }

  def respondWithSpriteSheet(dataSetName: String, dataLayerTyp: String, width: Int, height: Int, depth: Int, imagesPerRow: Int, x: Int, y: Int, z: Int, resolution: Int)(implicit request: UserAwareRequest[_]): Future[SimpleResult] = {
    val settings = DataRequestSettings(useHalfByte = false, skipInterpolation = false)
    for {
      dataSet <- DataSetDAO.findOneByName(dataSetName) ?~> Messages("dataSet.notFound")
      dataLayer <- dataSet.dataLayer(dataLayerTyp) ?~> Messages("dataLayer.notFound")
      params = ImageCreatorParameters(dataLayer.bytesPerElement, width, height, imagesPerRow)
      data <- requestData(dataSetName, dataLayerTyp, Point3D(x, y, z), width, height, depth, resolution, settings) ?~> Messages("binary.data.notFound")
      spriteSheet <- ImageCreator.spriteSheetFor(data, params) ?~> Messages("image.create.failed")
      firstSheet <- spriteSheet.pages.headOption ?~> "Couldn'T create spritesheet"
    } yield {
      val file = new JPEGWriter().writeToFile(firstSheet.image)
      Ok.sendFile(file, true, _ => "test.jpg").withHeaders(
        CONTENT_TYPE -> "image/jpeg")
    }
  }

  def respondWithImage(dataSetName: String, dataLayerTyp: String, width: Int, height: Int, x: Int, y: Int, z: Int, resolution: Int)(implicit request: UserAwareRequest[_]) = {
    respondWithSpriteSheet(dataSetName, dataLayerTyp, width, height, 1, 1, x, y, z, resolution)
  }

  def requestSpriteSheet(dataSetName: String, dataLayerTyp: String, cubeSize: Int, imagesPerRow: Int, x: Int, y: Int, z: Int, resolution: Int) = UserAwareAction.async(parse.raw) {
    implicit request =>
      respondWithSpriteSheet(dataSetName, dataLayerTyp, cubeSize, cubeSize, cubeSize, imagesPerRow, x, y, z, resolution)
  }

  def requestImage(dataSetName: String, dataLayerTyp: String, width: Int, height: Int, x: Int, y: Int, z: Int, resolution: Int) = UserAwareAction(parser = parse.raw) {
    implicit request =>
      respondWithImage(dataSetName, dataLayerTyp, width, height, x, y, z, resolution)
  }

  /**
   * Handles a request for binary data via websockets. The content of a websocket
   * message is defined in the BinaryProtokoll.parseWebsocket function.
   * If the message is valid the result is posted onto the websocket.
   *
   */

  //  def requestViaWebsocket(dataSetName: String, dataLayerTyp: String, cubeSize: Int): WebSocket[Array[Byte]] =
  //    AuthenticatedWebSocket[Array[Byte]]() {
  //      user =>
  //        request =>
  //          DataSetDAO.findOneByName(dataSetName)(user).map {
  //            dataSetOpt =>
  //              var channelOpt: Option[Channel[Array[Byte]]] = None
  //
  //              val output = Concurrent.unicast[Array[Byte]](
  //              {
  //                c => channelOpt = Some(c)
  //              }, {
  //                Logger.debug("Data websocket completed")
  //              }, {
  //                case (e, i) => Logger.error("An error ocourd on websocket stream: " + e)
  //              })
  //
  //              val input = Iteratee.foreach[Array[Byte]](in => {
  //                for {
  //                  dataSet <- dataSetOpt
  //                  dataLayer: DataLayer <- dataSet.dataLayer(dataLayerTyp) ?~> Messages("dataLayer.notFound")              
  //                  channel <- channelOpt
  //                  requests <- BinaryProtocol.parse(in, containsHandle = true)
  //                  dataRequestCollection = createDataRequestCollection(dataSet, dataLayer, cubeSize, requests)
  //                  dataOpt <- BinaryDataService.handleDataRequest(dataRequestCollection)
  //                  data <- dataOpt
  //                } {
  //                  val resultWithHandle = Seq(data, requests.handle.getOrElse(Array())).appendArrays
  //                  channel.push(resultWithHandle)
  //                }
  //              })
  //              (input, output)
  //          }
  //    }
}