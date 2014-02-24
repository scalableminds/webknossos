package controllers

import oxalis.security.Secured
import models.binary.{DataSetService, DataSetDAO}
import play.api.i18n.Messages
import views.html
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{Json, JsSuccess, JsError}
import scala.concurrent.Future
import oxalis.binary.BinaryDataService
import braingames.binary.repository.DataSourceRepository.InProgress
import braingames.binary.repository.DataSourceRepository.Finished
import braingames.binary.repository.DataSourceRepository.NotStarted

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 03.08.13
 * Time: 17:58
 */
object DataSetController extends Controller with Secured {

  def view(dataSetName: String) = UserAwareAction.async {
    implicit request =>
      for {
        dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
      } yield {
        Ok(html.tracing.view(dataSet))
      }
  }

  def listView = UserAwareAction.async {
    implicit request =>
      DataSetDAO.findAll.map {
        dataSets =>
          Ok(html.dataSets(dataSets))
      }
  }

  def list = UserAwareAction.async {
    implicit request =>
      DataSetDAO.findAll.map {
        dataSets =>
          Ok(Json.toJson(dataSets))
      }
  }

  def importDataSet(dataSetName: String) = Authenticated.async{ implicit request =>
    for {
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
      result <- DataSetService.importDataSet(dataSet) ?~> Messages("dataSet.import.notStarted")
    } yield {
      JsonOk(Messages("dataSet.import.inProgress"))
    }
  }

  def importProgress(dataSetName: String) = Authenticated{ implicit request =>
    BinaryDataService.importProgress(dataSetName) match{
      case InProgress(p) =>
        JsonOk(Json.obj(
          "operation" -> "import",
          "status" -> "inProgress",
          "progress" -> p))
      case Finished(success) =>
        JsonOk(Json.obj(
          "operation" -> "import",
          "status" -> (if(success) "finished" else "failed"),
          "progress" -> 1))
      case NotStarted =>
        JsonOk(Json.obj(
          "operation" -> "import",
          "status" -> "notStarted",
          "progress" -> 1))
    }
  }

  def updateTeams(dataSetName: String) = Authenticated.async(parse.json){ implicit request =>
    request.body.validate[List[String]] match{
      case JsSuccess(teams, _) =>
        for{
          dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
          _ <- allowedToAdministrate(request.user, dataSet).toFox
          _ <- DataSetService.updateTeams(dataSet, teams)
        } yield
          Ok
      case e: JsError =>
        Future.successful(BadRequest(JsError.toFlatJson(e)))
    }
  }
}

