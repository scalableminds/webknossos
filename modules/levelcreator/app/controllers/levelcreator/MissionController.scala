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

object MissionController extends Controller with GlobalDBAccess {

  def getMissions(dataSetName: String) = Action {
    implicit request =>
      Async {
        for {
          dataSet <- DataSetDAO.findOneByName(dataSetName) ?~> Messages("dataSet.notFound")
          missions = Mission.findByDataSetName(dataSet.name).toList
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
          mission <- Mission.randomByDataSetName(dataSetName) ?~ Messages("mission.notFound")
        } yield {
          Ok(Json.toJson(mission))
        }
      }
  }

  def getMission(missionId: String) = Action {
    implicit request =>
      for {
        mission <- Mission.findOneById(missionId) ?~ Messages("mission.notFound")
      } yield {
        Ok(Json.toJson(mission))
      }
  }
}