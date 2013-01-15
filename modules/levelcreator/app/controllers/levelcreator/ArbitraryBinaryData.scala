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
import models.knowledge.Level
import braingames.mvc.Controller
import play.api.i18n.Messages
import brainflight.tools.geometry._
import akka.pattern.ask
import akka.pattern.AskTimeoutException
import scala.collection.mutable.ArrayBuffer
import play.api.libs.concurrent.Execution.Implicits._

object ArbitraryBinaryData extends Controller {
  val dataRequestActor = Akka.system.actorOf(Props(new DataRequestActor), name = "dataRequestActor") //.withRouter(new RoundRobinRouter(3)))
  val conf = Play.configuration
  implicit val timeout = Timeout((conf.getInt("actor.defaultTimeout") getOrElse 5) seconds) // needed for `?` below

  def viaAjax(dataLayerName: String, levelId: String, taskId: String) = Action(parse.raw) { implicit request =>
    Async {
      val t = System.currentTimeMillis()
      val dataSet = DataSet.default
      for {
        level <- Level.findOneById(levelId) ?~ Messages("level.notFound")
        dataLayer <- dataSet.dataLayers.get(dataLayerName) ?~ Messages("dataLayer.notFound")
      } yield {
        val position = Point3D(200, 200, 200)
        val direction = (1.0, 1.0, 1.0)

        val point = (position.x.toDouble, position.y.toDouble, position.z.toDouble)
        val m = Cuboid(level.width, level.height, level.depth, 1, moveVector = point, axis = direction)
        val future =
          dataRequestActor ? SingleRequest(DataRequest(
            dataSet,
            dataLayer,
            1,
            m,
            useHalfByte = false,
            skipInterpolation = false))

        future
          .recover {
            case e: AskTimeoutException =>
              Logger.error("calculateImages: AskTimeoutException")
              new Array[Byte](level.height * level.width * level.depth).toBuffer
          }
          .mapTo[ArrayBuffer[Byte]].map { data =>
            Logger.debug("total: %d ms".format(System.currentTimeMillis - t))
            Ok(data.toArray)
          }
      }
    }
  }
}