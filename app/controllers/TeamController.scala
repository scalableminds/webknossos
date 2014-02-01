package controllers

import oxalis.security.Secured
import models.team.TeamDAO
import play.api.libs.json.Json
import play.api.libs.concurrent.Execution.Implicits._

/**
 * Created by tombocklisch on 30.01.14.
 */
object TeamController extends Controller with Secured {

  def list = Authenticated.async{ implicit request =>
    for{
      teams <- TeamDAO.findAll
    } yield Ok(Json.toJson(teams))
  }
}
