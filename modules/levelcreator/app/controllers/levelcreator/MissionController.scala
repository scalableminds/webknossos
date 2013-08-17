package controllers.levelcreator

import play.api.mvc.Action
import braingames.mvc._
import play.api.data._
import play.api.libs.json._
import braingames.binary.models.DataSet
import models.knowledge._
import play.api.i18n.Messages
import play.api.libs.concurrent.Execution.Implicits._
import braingames.reactivemongo.GlobalDBAccess
import models.knowledge.MissionDAO.formatter

object MissionController extends Controller with GlobalDBAccess {

  def getMissions(dataSetName: String) = Action {
    implicit request =>
      Async {
        for {
          dataSet <- DataSetDAO.findOneByName(dataSetName) ?~> Messages("dataSet.notFound")
          missions <- MissionDAO.findByDataSetName(dataSet.name)
        } yield {
          Ok(Json.toJson(missions))
        }
      }
  }

  def getRandomMission(dataSetName: String) = Action {
    implicit request =>
      Async {
        for {
          dataSet <- DataSetDAO.findOneByName(dataSetName) ?~> Messages("dataSet.notFound")
          mission <- MissionDAO.randomByDataSetName(dataSetName) ?~> Messages("mission.notFound")
        } yield {
          Ok(Json.toJson(mission))
        }
      }
  }

  def getMission(missionId: String) = Action {
    implicit request =>
      Async {
        for {
          mission <- MissionDAO.findOneById(missionId) ?~> Messages("mission.notFound")
        } yield {
          Ok(Json.toJson(mission))
        }
      }
  }
}