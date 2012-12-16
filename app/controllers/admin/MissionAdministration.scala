package controllers.admin

import controllers.Controller
import brainflight.security.Secured
import models.security.Role
import models.knowledge.Mission
import models.binary.DataSet
import brainflight.knowledge.MissionJsonParser
import play.api.Logger
import scala.io.Source
import java.io.File
import play.api.libs.json._

object MissionAdministration extends Controller with Secured {
  override def DefaultAccessRole = Role.Admin

  def JsonFromFile(file: File) = Json.parse(Source.fromFile(file).getLines.mkString)

  def insertMissions(dataSetName: String) = Authenticated() { implicit request =>
    (for {
      dataSet <- DataSet.findOneByName(dataSetName)
      missionData = new File(dataSet.baseDir + "/meta.json")
      if missionData.exists()
    } yield {
      val missions = new MissionJsonParser().parse(JsonFromFile(missionData)).filterNot(Mission.hasAlreadyBeenInserted).map(Mission.insertOne)
      Ok("Inserted %s new missions.".format(missions.size))
    }) getOrElse BadRequest("Missing meta file!")
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