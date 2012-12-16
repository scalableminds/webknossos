package controllers
import brainflight.security.Secured
import play.api._
import play.api.mvc._
import play.api.data._
import play.api.libs.json._
import play.api.Play.current
import models.knowledge.Mission
import models.binary.DataSet

object Knowledge extends Controller with Secured {

  def missions(dataSetId: String) = Authenticated { implicit request =>
    (for {
      dataSet <- DataSet.findOneById(dataSetId)
      missions <- Mission.findByDataSetName(dataSet.name)

    } yield {
      println(missions.mkString)
      Ok(Json.toJson(missions))}) getOrElse BadRequest("No dataset with id %s found".format(dataSetId))
  }
}