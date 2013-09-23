package controllers.stackrenderer

import models.stackrenderer.TemporaryStores._
import play.api.mvc.Action
import play.api.i18n.Messages
import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.Future
import play.api.mvc.Result
import controllers.levelcreator.BinaryDataRequestHandler
import braingames.mvc.ExtendedController
import play.api.mvc.Controller

object BinaryDataController extends ExtendedController with Controller with BinaryDataRequestHandler {
  override val binaryDataService = braingames.stackrenderer.BinaryDataService

  def viaAjax(dataSetName: String, levelId: String, missionId: String, dataLayerName: String) =
    Action {
      implicit request =>
        Async {
          for {
            dataSet <- dataSetStore.find(dataSetName) ?~> Messages("dataset.notFound")
            level <- levelStore.find(levelId) ?~> Messages("level.notFound")
            mission <- missionStore.find(missionId) ?~> Messages("mission.notFound")
            dataLayer <- dataSet.dataLayer(dataLayerName) ?~> Messages("dataLayer.notFound")
            result <- handleDataRequest(dataSet, dataLayerName, level, mission) ?~> "Data couldn'T be retireved"
          } yield {
            Ok(result).withHeaders("Access-Control-Allow-Origin" -> "*")
          }
        }
    }
}