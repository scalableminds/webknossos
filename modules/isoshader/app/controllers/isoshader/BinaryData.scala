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
import oxalis.binary._
import braingames.mvc.Controller
import play.api.i18n.Messages
import braingames.geometry._
import akka.pattern.ask
import akka.pattern.AskTimeoutException
import scala.collection.mutable.ArrayBuffer
import play.api.libs.concurrent.Execution.Implicits._
import braingames.binary.DataRequestSettings
import braingames.image.{JPEGWriter, ImageCreator, ImageCreatorParameters}
import braingames.reactivemongo.GlobalDBAccess

object BinaryData extends Controller with GlobalDBAccess{
  val conf = Play.current.configuration
  implicit val timeout = Timeout((conf.getInt("actor.defaultTimeout") getOrElse 20) seconds) // needed for `?` bel

  def requestImage(dataSetName: String, dataLayerName: String, imagesPerRow: Int, x: Int, y: Int, z: Int, resolution: Int) = Action {
    implicit request =>
      Async {
        val cubeSize = 128
        val settings = DataRequestSettings(useHalfByte = false, skipInterpolation = false)
        for {
          dataSet <- DataSetDAO.findOneByName(dataSetName) ?~> Messages("dataSet.notFound")
          dataLayer <- dataSet.dataLayer(dataLayerName) ?~> Messages("dataLayer.notFound")
          params = ImageCreatorParameters(dataLayer.bytesPerElement, cubeSize, cubeSize, imagesPerRow)
          data <- controllers.BinaryData.requestData(dataSetName, dataLayerName, Point3D(x, y, z), cubeSize, cubeSize, cubeSize, resolution, settings) ?~> Messages("binary.data.notFound")
          spriteSheet <- ImageCreator.spriteSheetFor(data, params) ?~> Messages("image.create.failed")
        } yield {
          val file = new JPEGWriter().writeToFile(spriteSheet.image)
          Ok.sendFile(file, true, _ => "test.jpg").withHeaders(
            CONTENT_TYPE -> "image/jpeg")
        }
      }
  }
}