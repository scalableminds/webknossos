package controllers

import java.nio.ByteBuffer
import akka.actor._
import akka.dispatch._
import scala.concurrent.duration._
import akka.pattern.{ask, pipe}
import akka.util.Timeout
import play.api._
import braingames.mvc.Controller
import play.api.mvc.{WebSocket, AsyncResult}
import play.api.data._
import play.api.libs.json.Json._
import play.api.Play.current
import play.api.libs.iteratee._
import Input.EOF
import play.api.libs.concurrent._
import play.api.libs.json.JsValue
import play.libs.Akka._
import models.security.Role
import models.binary._
import oxalis.security.{UserAwareRequest, AuthenticatedRequest, Secured}
import scala.concurrent.Future
import braingames.geometry.Point3D
import akka.pattern.AskTimeoutException
import play.api.libs.iteratee.Concurrent.Channel
import scala.collection.mutable.ArrayBuffer
import akka.routing.RoundRobinRouter
import play.api.libs.concurrent.Execution.Implicits._
import braingames.geometry.Vector3D
import akka.agent.Agent
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

//import scala.concurrent.ExecutionContext.Implicits.global

object BinaryData extends Controller with Secured {
  override val DefaultAccessRole = Role.User

  val conf = Play.configuration

  implicit val dispatcher = Akka.system.dispatcher
  val scaleFactors = Array(1, 1, 1)

  def requestData(dataSetName: String, dataLayerName: String, cubeSize: Int, dataRequest: MultipleDataRequest)(implicit request: UserAwareRequest[_]): Future[Box[Array[Byte]]] = {
    DataSetDAO.findOneByName(dataSetName).flatMap {
      case Some(dataSet) =>
        BinaryDataService.handleMultiDataRequest(dataRequest, dataSet, DataLayerId(dataLayerName), cubeSize).map(option2Box)
      case _ =>
        Future.successful(Failure(Messages("dataSet.notFound")))
    }
  }

  def requestViaAjaxDebug(dataSetName: String, dataLayerName: String, cubeSize: Int, x: Int, y: Int, z: Int, resolution: Int) = Authenticated {
    implicit request =>
      Async {
        val dataRequests = MultipleDataRequest(SingleDataRequest(resolution, Point3D(x, y, z), false))
        requestData(dataSetName, dataLayerName, cubeSize, dataRequests).map {
          b =>
            b.map(byteArray => Ok(byteArray))
        }
      }
  }

  /**
   * Handles a request for binary data via a HTTP POST. The content of the
   * POST body is specified in the BinaryProtokoll.parseAjax functions.
   */
  def requestViaAjax(dataSetName: String, dataLayerName: String, cubeSize: Int) = UserAwareAction(parser = parse.raw) {
    implicit request =>
      Async {
        (for {
          payload <- request.body.asBytes() ?~ Messages("binary.payload.notSupplied")
          message <- BinaryProtocol.parseAjax(payload) ?~ Messages("binary.payload.invalid")
        } yield {
          message match {
            case dataRequests@MultipleDataRequest(_) =>
              requestData(dataSetName, dataLayerName, cubeSize, dataRequests).map {
                b =>
                  b.map{byteArray =>
                    Ok(byteArray)}
              }
            case _ =>
              Akka.future {
                Failure("Unknown message.")
              }
          }
        }).flatten.map(box2Result)
      }
  }

  def respondeWithImage(dataSetName: String, dataLayerName: String, cubeSize: Int, imagesPerRow: Int, x: Int, y: Int, z: Int, resolution: Int)(implicit request: UserAwareRequest[_]) = {
    Async {
      val dataRequests = MultipleDataRequest(SingleDataRequest(resolution, Point3D(x, y, z), false))

      requestData(dataSetName, dataLayerName, cubeSize, dataRequests).map {
        b =>
          b.flatMap {
            byteArray =>
              val params = ImageCreatorParameters(
                bytesPerElement = byteArray.length / cubeSize / cubeSize / cubeSize,
                slideWidth = cubeSize,
                slideHeight = cubeSize,
                imagesPerRow = imagesPerRow)

              ImageCreator.createImage(byteArray, params).map {
                combinedImage =>
                  val file = new JPEGWriter().writeToFile(combinedImage.image)
                  Ok.sendFile(file, true, _ => "test.jpg").withHeaders(
                    CONTENT_TYPE -> "image/jpeg")
              }
          }
      }
    }
  }

  def requestImage(dataSetName: String, dataLayerName: String, cubeSize: Int, imagesPerRow: Int, x: Int, y: Int, z: Int, resolution: Int) = UserAwareAction(parser = parse.raw) {
    implicit request =>
      respondeWithImage(dataSetName, dataLayerName, cubeSize, imagesPerRow, x, y, z, resolution)
  }

  /**
   * Handles a request for binary data via websockets. The content of a websocket
   * message is defined in the BinaryProtokoll.parseWebsocket function.
   * If the message is valid the result is posted onto the websocket.
   *
   */

  def requestViaWebsocket(dataSetName: String, dataLayerName: String, cubeSize: Int): WebSocket[Array[Byte]] =
    AuthenticatedWebSocket[Array[Byte]]() {
      user =>
        request =>
          DataSetDAO.findOneByName(dataSetName)(user).map {
            dataSetOpt =>
              var channelOpt: Option[Channel[Array[Byte]]] = None

              val output = Concurrent.unicast[Array[Byte]](
              {
                c => channelOpt = Some(c)
              }, {
                Logger.debug("Data websocket completed")
              }, {
                case (e, i) => Logger.error("An error ocourd on websocket stream: " + e)
              })

              val input = Iteratee.foreach[Array[Byte]](in => {
                for {
                  dataSet <- dataSetOpt
                  channel <- channelOpt
                } {
                  val dataLayer = DataLayerId(dataLayerName)
                  try {
                    BinaryProtocol.parseWebsocket(in).map {
                      case dataRequests: MultipleDataRequest =>
                        Logger.trace("Websocket DataRequests: " + dataRequests.requests.mkString(", "))
                        BinaryDataService.handleMultiDataRequest(dataRequests, dataSet, dataLayer, cubeSize).map(_.map {
                          result =>
                            Logger.trace("Websocket result size: " + result.size)
                            val resultWithHandle = Seq(result, dataRequests.handle).appendArrays
                            channel.push(resultWithHandle)
                        })
                      case _ =>
                        Logger.error("Received unhandled message!")
                    }
                  } catch {
                    case e: Throwable =>
                      Logger.error("FAIL in Websocket: " + e.toString)
                  }
                }
              })
              (input, output)
          }
    }
}