package controllers
import brainflight.security.Secured
import play.api._
import play.api.mvc._
import play.api.data._
import play.api.libs.json._
import play.api.Play.current
import models.knowledge.Mission
import models.binary.DataSet
import play.api.i18n.Messages

object Knowledge extends Controller with Secured {

  def missions(dataSetName: String) = Authenticated { implicit request =>
    for {
      dataSet <- DataSet.findOneByName(dataSetName) ?~ Messages("dataSet.notFound")
      missions <- Mission.findByDataSetName(dataSet.name) ?~ Messages("mission.notFound")
    } yield {
      Ok(Json.toJson(missions))
    }
  }
}