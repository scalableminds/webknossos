package controllers.admin

import controllers.Controller
import brainflight.security.Secured
import models.security.Role
import models.knowledge.Mission
import brainflight.knowledge.MissionJsonParser
import play.api.Logger

object MissionAdministration extends Controller with Secured{
  override def DefaultAccessRole = Role.Admin
  
  def insertMissions = Authenticated(parse.json(maxLength = 2097152)){implicit request =>
    val missions = new MissionJsonParser().parse(request.body).map{ mission =>
      Mission.insertOne(mission)
    }
    Logger.debug("Inserted %s new missions.".format(missions.size))
    Ok
  }
}