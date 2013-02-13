package controllers

import java.nio.ByteBuffer
import akka.actor._
import akka.dispatch._
import scala.concurrent.duration._
import akka.pattern.{ ask, pipe }
import akka.util.Timeout
import play.api._
import braingames.mvc.Controller
import play.api.mvc.AsyncResult
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
import brainflight.binary._
import brainflight.security.Secured
import scala.concurrent.Future
import brainflight.tools.geometry.Point3D
import akka.pattern.AskTimeoutException
import play.api.libs.iteratee.Concurrent.Channel
import scala.collection.mutable.ArrayBuffer
import akka.routing.RoundRobinRouter
import play.api.libs.concurrent.Execution.Implicits._
import brainflight.tools.geometry.Vector3D
import brainflight.binary.Cuboid
import akka.agent.Agent
import akka.routing.RoundRobinRouter
import scala.concurrent.Future
import play.api.i18n.Messages
//import scala.concurrent.ExecutionContext.Implicits.global

object BinaryData extends Controller with Secured {
  override val DefaultAccessRole = Role.User

  val dataRequestActor = Akka.system.actorOf(Props(new DataRequestActor), name = "dataRequestActor") //.withRouter(new RoundRobinRouter(3)))

  implicit val dispatcher = Akka.system.dispatcher
  val conf = Play.configuration
  val scaleFactors = Array(1, 1, 1)

  implicit val timeout = Timeout((conf.getInt("actor.defaultTimeout") getOrElse 5) seconds) // needed for `?` below

  def resolutionFromExponent(resolutionExponent: Int) =
    math.pow(2, resolutionExponent).toInt

  def cuboidFromPosition(position: Point3D, cubeSize: Int, resolution: Int) = {
    val cubeCorner = Vector3D(position.scale {
      case (x, i) =>
        x - x % (cubeSize / scaleFactors(i))
    })
    Cuboid(cubeSize / scaleFactors(0), cubeSize / scaleFactors(1), cubeSize / scaleFactors(2), resolution, Some(cubeCorner))
  }

  def handleMultiDataRequest(multi: MultipleDataRequest, dataSet: DataSet, dataLayer: DataLayer, cubeSize: Int): Future[ArrayBuffer[Byte]] = {
    val cubeRequests = multi.requests.map { request =>
      val resolution = resolutionFromExponent(request.resolutionExponent)
      val cuboid = cuboidFromPosition(request.position, cubeSize, resolution)
      SingleRequest(
        DataRequest(
          dataSet,
          dataLayer,
          resolution,
          cuboid,
          useHalfByte = request.useHalfByte,
          skipInterpolation = true))
    }

    val future = (dataRequestActor ? MultiCubeRequest(cubeRequests)) recover {
      case e: AskTimeoutException =>
        Logger.warn("Data request to DataRequestActor timed out!")
        new ArrayBuffer[Byte](0)
    }

    future.mapTo[ArrayBuffer[Byte]]
  }

  def requestViaAjaxDebug(dataSetId: String, dataLayerName: String, cubeSize: Int, x: Int, y: Int, z: Int, resolution: Int) = Authenticated { implicit request =>
    Async {
      for {
        dataSet <- DataSet.findOneById(dataSetId) ?~ Messages("dataSet.notFound")
        dataLayer <- dataSet.dataLayers.get(dataLayerName) ?~ Messages("dataLayer.notFound")
      } yield {
        val dataRequest = MultipleDataRequest(Array(SingleDataRequest(resolution, Point3D(x, y, z), false)))
        handleMultiDataRequest(dataRequest, dataSet, dataLayer, cubeSize).map(result =>
          Ok(result.toArray))
      }
    }
  }

  /**
   * Handles a request for binary data via a HTTP POST. The content of the
   * POST body is specified in the BinaryProtokoll.parseAjax functions.
   */
  def requestViaAjax(dataSetId: String, dataLayerName: String, cubeSize: Int) = Authenticated(parser = parse.raw) { implicit request =>
    Async {
      for {
        payload <- request.body.asBytes() ?~ Messages("binary.payload.notSupplied")
        message <- BinaryProtocol.parseAjax(payload) ?~ Messages("binary.payload.invalid")
        dataSet <- DataSet.findOneById(dataSetId) ?~ Messages("dataSet.notFound")
        dataLayer <- dataSet.dataLayers.get(dataLayerName) ?~ Messages("dataLayer.notFound")
      } yield {
        message match {
          case dataRequests @ MultipleDataRequest(_) =>
            handleMultiDataRequest(dataRequests, dataSet, dataLayer, cubeSize).map(result =>
              Ok(result.toArray))
          case _ =>
            Akka.future {
              BadRequest("Unknown message.")
            }
        }
      }
    }
  }
  /**
   * Handles a request for binary data via websockets. The content of a websocket
   * message is defined in the BinaryProtokoll.parseWebsocket function.
   * If the message is valid the result is posted onto the websocket.
   *
   * @param
   * 	modelType:	id of the model to use
   */
  def requestViaWebsocket(dataSetId: String, dataLayerName: String, cubeSize: Int) = AuthenticatedWebSocket[Array[Byte]]() { user =>

    request =>
      val dataSetOpt = DataSet.findOneById(dataSetId)
      var channelOpt: Option[Channel[Array[Byte]]] = None

      val output = Concurrent.unicast[Array[Byte]](
        { c => channelOpt = Some(c) },
        { Logger.debug("Data websocket completed") },
        { case (e, i) => Logger.error("An error ocourd on websocket stream: " + e) })

      val input = Iteratee.foreach[Array[Byte]](in => {
        for {
          dataSet <- dataSetOpt
          dataLayer <- dataSet.dataLayers.get(dataLayerName)
          channel <- channelOpt
        } {
          try {
            BinaryProtocol.parseWebsocket(in).map {
              case dataRequests: MultipleDataRequest =>
                Logger.trace("Websocket DataRequests: " + dataRequests.requests.mkString(", "))
                handleMultiDataRequest(dataRequests, dataSet, dataLayer, cubeSize).map { result =>
                  Logger.trace("Websocket result size: " + result.size)
                  channel.push((result ++= dataRequests.handle).toArray)
                }
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