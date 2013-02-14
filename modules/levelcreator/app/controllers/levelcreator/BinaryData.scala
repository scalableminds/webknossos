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

object BinaryData extends Controller {
  val dataRequestActor = Akka.system.actorOf(Props(new DataRequestActor), name = "dataRequestActor") //.withRouter(new RoundRobinRouter(3)))

  val conf = Play.current.configuration
  implicit val timeout = Timeout((conf.getInt("actor.defaultTimeout") getOrElse 20) seconds) // needed for `?` below
    
  def viaAjax(dataSetName: String, levelId: String, missionId: String, dataLayerName: String) = 
    Action { implicit request => 
    Async {
      val t = System.currentTimeMillis()
      for {
        dataSet <- DataSet.findOneByName(dataSetName) ?~ Messages("dataset.notFound")
        level <- Level.findOneById(levelId) ?~ Messages("level.notFound")
        mission <- Mission.findOneById(missionId) ?~ Messages("mission.notFound")
        dataLayer <- dataSet.dataLayers.get(dataLayerName) ?~ Messages("dataLayer.notFound")
      } yield {
        (dataRequestActor ? SingleRequest(DataRequest(
          dataSet,
          dataLayer,
          1, // TODO resolution needed?
          Cuboid(level.width, 
              level.height, 
              level.depth, 
              1, 
              moveVector = Vector3D(mission.start.position).toTuple, 
              axis = mission.start.direction.toTuple),
          useHalfByte = false,
          skipInterpolation = false)))
        .recover{
          case e: AskTimeoutException =>
            Logger.error("calculateImages: AskTimeoutException")
            new Array[Byte](level.height * level.width * level.depth * dataLayer.bytesPerElement).toBuffer
        }
        .mapTo[ArrayBuffer[Byte]].map { data =>
          Logger.debug("total: %d ms".format(System.currentTimeMillis - t))
          Ok(data.toArray)
        }
      }
    }
  }
}
