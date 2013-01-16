package controllers.levelcreator.admin

import play.api.mvc.Action
import braingames.mvc._
import brainflight.security.Secured
import models.security.Role
import models.knowledge.Mission
import models.binary.DataSet
import braingames.levelcreator.{MetaJsonParser, DataLayerSettings, MetaJson}
import play.api.Logger
import scala.io.Source
import java.io.File
import play.api.libs.json._
import play.api.i18n.Messages

object MissionAdministration extends Controller {

  def JsonFromFile(file: File) = Json.parse(Source.fromFile(file).getLines.mkString)

  def insertMetaData(dataSetName: String) = Action { implicit request =>
    (for {
      dataSet <- DataSet.findOneByName(dataSetName) ?~ Messages("dataSet.notFound")
      missionData = new File(dataSet.baseDir + "/meta.json") 
      if missionData.exists()
      MetaJson <- MetaJsonParser.parse(JsonFromFile(missionData)) ?~ Messages("Meta.json parsing Error")
    } yield {     
      val newMissions = MetaJson.missions.filterNot(Mission.hasAlreadyBeenInserted)
      newMissions.map(Mission.insertOne)
      
      DataSet.updateOrCreate(dataSet.copy(dataLayers = MetaJson.dataLayerSettings.dataLayers))
      
      Ok("Inserted %s new missions and updated DataLayers %s.".format(newMissions.size, MetaJson.dataLayerSettings.dataLayers.keys))
    }) ?~ Messages("mission.metaFile.notFound")
  }

//  def insertMissions = Authenticated(parse.multipartFormData) { implicit request =>
//    request.body.file("missionData").map { missionData =>
//      val missions = new MissionJsonParser().parse(JsonFromFile(missionData.ref.file)).map { mission =>
//        Mission.insertOne(mission)
//      }
//
//      //  def insertMissions = Authenticated(parse.json(maxLength = 2097152)){implicit request =>
//      //    val missions = new MissionJsonParser().parse(request.body).map{ mission =>
//      //      Mission.insertOne(mission)
//      //    }
//      Logger.debug("Inserted %s new missions.".format(missions.size))
//      Ok
//    } getOrElse BadRequest("Missing file!")
//  }
}