package controllers

import oxalis.security.Secured
import models.binary.{DataSet, DataSetService, DataSetDAO}
import play.api.i18n.Messages
import views.html
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import scala.concurrent.Future
import oxalis.binary.BinaryDataService
import braingames.binary.repository.DataSourceRepository.InProgress
import braingames.binary.repository.DataSourceRepository.Finished
import braingames.binary.repository.DataSourceRepository.NotStarted
import braingames.util.DefaultConverters._
import play.api.mvc._
import net.liftweb.common.Full
import oxalis.user.UserActivity
import scala.Some
import play.api.mvc.SimpleResult
import play.api.libs.json.JsSuccess
import scala.Some
import play.api.libs.json
import models.user.User
import play.api.templates.Html
import braingames.binary.repository.DataSourceRepository

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 03.08.13
 * Time: 17:58
 */
object DataSetController extends Controller with Secured {

  def view(dataSetName: String
            ) = UserAwareAction.async {
    implicit request =>
      for {
        dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
      } yield {
        Ok(html.tracing.view(dataSet))
      }
  }

  def empty = Authenticated{ implicit request =>
    Ok(views.html.main()(Html.empty))
  }

  def spotlight = UserAwareAction.async {
    implicit request =>
      DataSetDAO.findAll.map {
        dataSets =>
          Ok(html.dataSets(dataSets))
      }
  }

  def list = Authenticated.async{ implicit request =>
    UsingFilters(
      Filter("isEditable", (value: Boolean, el: DataSet) =>
        el.isEditableBy(request.userOpt) && value || !el.isEditableBy(request.userOpt) && !value),
      Filter("isActive", (value: Boolean, el: DataSet) =>
        el.isActive == value)
    ){ filter =>
      DataSetDAO.findAll.map {
        dataSets =>
          Ok(Writes.list(DataSet.dataSetPublicWrites(request.userOpt)).writes(filter.applyOn(dataSets)))
      }
    }
  }

  def read(dataSetName: String) = UserAwareAction.async{ implicit request =>
    import net.liftweb.common._
    import play.api.Logger
    Logger.error("Dataset read: " + dataSetName)
    DataSetDAO.findOneBySourceName(dataSetName).futureBox.map {
      case Full(dataSet) =>
        Logger.error("Success: " + dataSetName)
        Ok(DataSet.dataSetPublicWrites(request.userOpt).writes(dataSet))
      case Empty =>
        Logger.error("Empty: " + dataSetName)
        BadRequest("Not found")
      case f: Failure =>
        Logger.error("Failure: " + dataSetName)
        BadRequest("failure: " + f)
    }
  }

  def importDataSet(dataSetName: String) = Authenticated.async{ implicit request =>
    for {
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
      result <- DataSetService.importDataSet(dataSet) ?~> Messages("dataSet.import.notStarted")
    } yield {
      progressToResult(InProgress(0))
    }
  }

  def progressToResult(progress: DataSourceRepository.ProgressState) = progress  match{
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
        "progress" -> 0))
  }


  def importProgress(dataSetName: String) = Authenticated{ implicit request =>
    progressToResult(BinaryDataService.importProgress(dataSetName))
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

