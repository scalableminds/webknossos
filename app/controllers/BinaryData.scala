package controllers

import java.nio.ByteBuffer
import akka.actor._
import akka.dispatch._
import akka.util.duration._
import akka.pattern.{ ask, pipe }
import akka.util.Timeout
import play.api._
import play.api.mvc._
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
import brainflight.tools.geometry.Point3D
import akka.pattern.AskTimeoutException
import play.api.libs.iteratee.Concurrent.Channel
import scala.collection.mutable.ArrayBuffer
import akka.routing.RoundRobinRouter
import play.api.libs.concurrent.execution.defaultContext
import brainflight.tools.geometry.Vector3D
import models.knowledge.Level
//import scala.concurrent.ExecutionContext.Implicits.global

object BinaryData extends Controller with Secured {

  val dataSetActor = Akka.system.actorOf(Props(new DataSetActor).withRouter(
    RoundRobinRouter(nrOfInstances = 8)))

  override val DefaultAccessRole = Role.User

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

  def handleMultiDataRequest(multi: MultipleDataRequest, dataSet: DataSet, dataLayer: DataLayer, cubeSize: Int, halfByte: Boolean) = {
    val cubeRequests = multi.requests.map { request =>
      val resolution = resolutionFromExponent(request.resolutionExponent)
      val cuboid = cuboidFromPosition(request.position, cubeSize, resolution)
      SingleRequest(
        DataRequest(
          dataSet,
          dataLayer,
          resolution,
          cuboid,
          useHalfByte = halfByte))
    }

    val future = (dataSetActor ? MultiCubeRequest(cubeRequests)) recover {
      case e: AskTimeoutException =>
        new ArrayBuffer[Byte](0)
    }

    future.mapTo[ArrayBuffer[Byte]]
  }

  def arbitraryViaAjax(dataLayerName: String, levelId: String, taskId: String) = Authenticated(parser = parse.raw) { implicit request =>
    Async {
      Level.findOneById(levelId).flatMap { level =>
        val t = System.currentTimeMillis()
        val dataSet = DataSet.default
        dataSet.dataLayers.get(dataLayerName).map { dataLayer =>
          val position = Point3D(1920, 2048, 2432)
          val direction = (1.0, 1.0, 1.0)

          val point = (position.x.toDouble, position.y.toDouble, position.z.toDouble)
          val m = Cuboid(level.width, level.height, level.depth, 1, moveVector = point, axis = direction)
          val future =
            dataSetActor ? SingleRequest(DataRequest(
              dataSet,
              dataLayer,
              1,
              m))

          future
            .recover {
              case e: AskTimeoutException =>
                Logger.error("calculateImages: AskTimeoutException")
                new Array[Byte](level.height * level.width * level.depth).toBuffer
            }
            .mapTo[ArrayBuffer[Byte]].asPromise.map { data =>
              Logger.debug("total: %d ms".format(System.currentTimeMillis - t))
              Ok(data.toArray)
            }
        }
      } getOrElse {
        Akka.future(BadRequest("Level not found."))
      }
    }
  }

  /**
   * Handles a request for binary data via a HTTP POST. The content of the
   * POST body is specified in the BinaryProtokoll.parseAjax functions.
   */
  def requestViaAjax(dataSetId: String, dataLayerName: String, cubeSize: Int, halfByte: Boolean) = Authenticated(parser = parse.raw) { implicit request =>
    Async {
      (for {
        payload <- request.body.asBytes()
        message <- BinaryProtocol.parseAjax(payload)
        dataSet <- DataSet.findOneById(dataSetId)
        dataLayer <- dataSet.dataLayers.get(dataLayerName)
      } yield {
        message match {
          case dataRequests @ MultipleDataRequest(_) =>
            handleMultiDataRequest(dataRequests, dataSet, dataLayer, cubeSize, halfByte).asPromise.map(result =>
              Ok(result.toArray))
          case _ =>
            Akka.future {
              BadRequest("Unknown message.")
            }
        }
      }) getOrElse (Akka.future { BadRequest("Request body is to short: %d bytes".format(request.body.size)) })
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
  def requestViaWebsocket(dataSetId: String, dataLayerName: String, cubeSize: Int, halfByte: Boolean) = AuthenticatedWebSocket[Array[Byte]]() { user =>

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
          BinaryProtocol.parseWebsocket(in).map {
            case dataRequests: MultipleDataRequest =>
              handleMultiDataRequest(dataRequests, dataSet, dataLayer, cubeSize, halfByte).map(
                result => channel.push((result ++= dataRequests.handle).toArray))
            case _ =>
              Logger.error("Received unhandled message!")
          }
        }
      })
      (input, output)
  }
}