package controllers.isoshader

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
  implicit val timeout = Timeout((conf.getInt("actor.defaultTimeout") getOrElse 20) seconds) // needed for `?` bel
  
  val cubeSize = 64
  def cuboidFromPosition(px: Int, py: Int, pz: Int) = {
    val cubeCorner = Vector3D(px - px % cubeSize, py - py % cubeSize, pz - pz % cubeSize)
    Cuboid(cubeSize, cubeSize, cubeSize, 1, Some(cubeCorner))
  }
  
  def viaAjax(dataSetName: String, px: Int, py: Int, pz: Int) = 
    Action { implicit request => 
    Async {
      val t = System.currentTimeMillis()
      for {
        dataSet <- DataSet.findOneByName(dataSetName) ?~ Messages("dataset.notFound")
        dataLayer <- dataSet.dataLayers.get("color")
      } yield {
        (dataRequestActor ? SingleRequest(DataRequest(
          dataSet,
          dataLayer,
          1,
          cuboidFromPosition(px, py, pz),
          useHalfByte = false,
          skipInterpolation = true)))
        .recover{
          case e: AskTimeoutException =>
            Logger.error("calculateImages: AskTimeoutException")
            new Array[Byte](cubeSize * cubeSize * cubeSize * dataLayer.bytesPerElement).toBuffer
        }
        .mapTo[ArrayBuffer[Byte]].map { data =>
          Logger.debug("total: %d ms".format(System.currentTimeMillis - t))
          Ok(data.toArray)
        }
      }
    }
  }
}