package controllers
import brainflight.security.Secured
import play.api._
import play.api.mvc._
import play.api.data._
import play.api.libs.json._
import play.api.Play.current
import models.knowledge.Mission
import models.binary.DataSet
import models.security.Role

object Knowledge extends Controller with Secured {
  override val DefaultAccessRole = Role.User
  def missions(dataSetName: String) = Authenticated { implicit request =>
    (for {
      dataSet <- DataSet.findOneByName(dataSetName)
      missions <- Mission.findByDataSetName(dataSet.name)
    } yield {
      Ok(Json.toJson(missions))
    }) getOrElse BadRequest("No dataset or Mission for dataset %s found".format(dataSetName))
  }
}