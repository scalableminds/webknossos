package controllers.levelcreator

import akka.actor._
import akka.dispatch._
import scala.concurrent.duration._
import play.api._
import play.api.mvc._
import play.api.data._
import play.api.libs.json.Json._
import play.api.libs.iteratee._
import play.api.libs.concurrent._
import play.libs.Akka._
import play.api.Play.current
import models.binary._
import akka.util.Timeout
import brainflight.binary._
import models.knowledge._
import braingames.mvc.Controller
import play.api.i18n.Messages
import brainflight.tools.geometry._
import akka.pattern.ask
import akka.pattern.AskTimeoutException
import scala.collection.mutable.ArrayBuffer
import play.api.libs.concurrent.Execution.Implicits._
import models.binary.DataLayer
import models.binary.DataSet

object BinaryData extends Controller {
  val dataRequestActor = Akka.system.actorOf(Props(new DataRequestActor), name = "dataRequestActor") //.withRouter(new RoundRobinRouter(3)))

  val conf = Play.current.configuration
  implicit val timeout = Timeout((conf.getInt("actor.defaultTimeout") getOrElse 20) seconds) // needed for `?` below

  def createStackCuboid(level: Level, mission: Mission) = {

    def calculateTopLeft(width: Int, height: Int, depth: Int) = {
      Vector3D(-(width / 2.0).floor, -(height / 2.0).floor, 0)
    }

    val realDirection = mission.start.direction
    //val direction = Vector3D(realDirection.x, realDirection.z, -realDirection.y)
    val direction = realDirection

    Cuboid(level.width,
      level.height,
      level.depth,
      1,
      topLeftOpt = Some(calculateTopLeft(level.width, level.height, level.depth)),
      moveVector = (Vector3D(mission.errorCenter) - (realDirection * level.slidesBeforeProblem)).toTuple,
      axis = direction.toTuple)
  }

  def handleDataRequest(dataSet: DataSet, dataLayer: DataLayer, level: Level, mission: Mission) = {
    val t = System.currentTimeMillis()
    (dataRequestActor ? SingleRequest(DataRequest(
      dataSet,
      dataLayer,
      1,
      createStackCuboid(level, mission),
      useHalfByte = false,
      skipInterpolation = false)))
      .recover {
        case e: AskTimeoutException =>
          Logger.error("calculateImages: AskTimeoutException")
          new Array[Byte](level.height * level.width * level.depth * dataLayer.bytesPerElement).toBuffer
      }
      .mapTo[ArrayBuffer[Byte]].map { data =>
        Logger.debug("Stack data aggregation: %d ms".format(System.currentTimeMillis - t))
        Ok(data.toArray)
      }
  }

  def viaAjax(dataSetName: String, levelId: String, missionId: String, dataLayerName: String) =
    Action { implicit request =>
      Async {
        for {
          dataSet <- DataSet.findOneByName(dataSetName) ?~ Messages("dataset.notFound")
          level <- Level.findOneById(levelId) ?~ Messages("level.notFound")
          mission <- Mission.findOneById(missionId) ?~ Messages("mission.notFound")
          dataLayer <- dataSet.dataLayers.get(dataLayerName) ?~ Messages("dataLayer.notFound")
        } yield {
          handleDataRequest(dataSet, dataLayer, level, mission)
        }
      }
    }
}
