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
import braingames.geometry._
import akka.pattern.ask
import akka.pattern.AskTimeoutException
import scala.collection.mutable.ArrayBuffer
import play.api.libs.concurrent.Execution.Implicits._

object BinaryData extends Controller {
  val conf = Play.current.configuration
  implicit val timeout = Timeout((conf.getInt("actor.defaultTimeout") getOrElse 20) seconds) // needed for `?` bel

  def requestImage(dataSetName: String, dataLayerName: String, imagesPerRow: Int, x: Int, y: Int, z: Int, resolution: Int) = Action { implicit request =>
    controllers.BinaryData.respondeWithImage(dataSetName, dataLayerName, imagesPerRow, x, y, z, resolution)
  }
}