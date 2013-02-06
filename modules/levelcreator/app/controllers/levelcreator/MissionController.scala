package controllers.levelcreator
import play.api.mvc.Action
import braingames.mvc._
import play.api.data._
import play.api.libs.json._
import models.binary.DataSet
import models.knowledge._
import play.api.i18n.Messages

object MissionController extends Controller {

  def getMissions(dataSetName: String) = Action { implicit request =>
    for {
      dataSet <- DataSet.findOneByName(dataSetName) ?~ Messages("dataSet.notFound")
      missions <- Mission.findByDataSetName(dataSet.name) ?~ Messages("mission.notFound")
    } yield {
      Ok(Json.toJson(missions))
    }
  }
  
  def getRandomMission(dataSetName: String) = Action { implicit request => 
    for {
      dataSet <- DataSet.findOneByName(dataSetName) ?~ Messages("dataSet.notFound")
      mission <- Mission.randomByDataSetName(dataSetName) ?~ Messages("mission.notFound")
    } yield {
      Ok(Json.toJson(mission))
    } 
  }
}