package controllers.levelcreator

import play.api._
import play.api.mvc._

object Application extends Controller {

  def javascriptRoutes = Action { implicit request =>
    Ok(
      Routes.javascriptRouter("jsRoutes")( //fill in stuff which should be able to be called from js
        controllers.levelcreator.routes.javascript.LevelCreator.deleteAsset,
        controllers.levelcreator.routes.javascript.LevelCreator.listAssets,
        controllers.levelcreator.routes.javascript.LevelCreator.retrieveAsset,
        controllers.levelcreator.routes.javascript.LevelCreator.produce,
        controllers.levelcreator.routes.javascript.BinaryData.viaAjax,
        controllers.levelcreator.routes.javascript.MissionController.getRandomMission,
        controllers.levelcreator.routes.javascript.MissionController.getMission
      )).as("text/javascript")
  }
  
}