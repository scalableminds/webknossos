package controllers

import oxalis.security.Secured
import models.binary.{DataSet, DataSetService, DataSetDAO}
import play.api.i18n.Messages
import views.html
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import scala.concurrent.Future
import oxalis.binary.BinaryDataService
import braingames.util.DefaultConverters._
import play.api.libs.json.JsSuccess
import play.api.templates.Html
import braingames.util._
import play.api.libs.json.JsSuccess
import braingames.util.Finished
import braingames.util.InProgress

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
        Ok(views.html.main()(Html.empty))
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
    DataSetDAO.findOneBySourceName(dataSetName).map { dataSet =>
      Ok(DataSet.dataSetPublicWrites(request.userOpt).writes(dataSet))
    }
  }

  def importDataSet(dataSetName: String) = Authenticated.async{ implicit request =>
    for {
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
    } yield {
      DataSetService.importDataSet(dataSet)
      progressToResult(InProgress(0))
    }
  }

  def importAll = Authenticated.async{ implicit request =>
    for {
      dataSets <- DataSetDAO.findAll ?~> Messages("dataSet.notFound")
      result <- Fox.sequence(dataSets.map(dataSet => DataSetService.importDataSet(dataSet)))
    } yield {
      progressToResult(InProgress(0))
    }
  }

  def progressToResult(progress: ProgressState) = progress  match{
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
    progressToResult(BinaryDataService.progressForImport(dataSetName))
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

