package controllers.stackrenderer

import braingames.mvc.Controller
import models.stackrenderer.TemporaryStores._
import play.api.mvc.Action
import play.api.i18n.Messages
import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.Future
import play.api.mvc.Result

object BinaryDataController extends Controller {
  def viaAjax(dataSetName: String, levelId: String, missionId: String, dataLayerName: String) =
    Action { implicit request =>
      Async {
        val result: Future[Result] = for {
          dataSet <- dataSetStore.find(dataSetName) ?~ Messages("dataset.notFound")
          level <- levelStore.find(levelId) ?~ Messages("level.notFound")
          mission <- missionStore.find(missionId) ?~ Messages("mission.notFound")
          dataLayer <- dataSet.dataLayers.get(dataLayerName) orElse dataSet.dataLayers.get(s"$dataLayerName${mission.batchId}") ?~ Messages("dataLayer.notFound")
        } yield {
          controllers.levelcreator.BinaryData.handleDataRequest(dataSet, dataLayer, level, mission)
        }
        result.map(_.withHeaders("Access-Control-Allow-Origin" -> "*"))
      }
    }
}