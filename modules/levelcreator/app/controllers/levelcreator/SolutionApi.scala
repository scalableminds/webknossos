package controllers.levelcreator

import braingames.mvc.ExtendedController
import play.api.mvc._
import models.knowledge._
import play.api.libs.json.{JsArray, Json}
import reactivemongo.api.DB
import braingames.reactivemongo.{UnAuthedDBAccess, DBAccessContext}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.Logger

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 20.08.13
 * Time: 20:37
 */
object SolutionApi extends ExtendedController with Controller with UnAuthedDBAccess{

  def createMissionJsonFlatWriter(renderedStacks: List[RenderedStack], solutions: List[MissionSolution]) = {
    import MissionSolutionDAO._
    val groupedStacks = renderedStacks.groupBy(_.mission._id)
    val groupedSolutions = solutions.groupBy(_._renderedStack)

    def missionJson(mission: Mission) = {
      val renderedStacksJson = groupedStacks.getOrElse(mission._id, Nil).flatMap{stack =>
        val solutionsForStack = groupedSolutions.getOrElse(stack._id, Nil)
        if(!solutionsForStack.isEmpty)
          Some(RenderedStackDAO.formatter.writes(stack) ++ Json.obj("solutions" -> solutionsForStack))
        else
          None
      }

      MissionDAO.formatter.writes(mission) ++
        Json.obj("renderedStacks" -> renderedStacksJson)
    }

    missionJson _
  }

  def solutions(batchId: Int, dataSetName: String) = Action {
    implicit request =>
      Async {
        val missionKeyRx = Mission.keyForMissionInfo(dataSetName, batchId, "*")
        for {
          missions <- MissionDAO.findByBatch(dataSetName, batchId)
          renderedStacks <- RenderedStackDAO.findByMissionKeyRx(missionKeyRx)
          solutions <- MissionSolutionDAO.findByMissionKeyRx(missionKeyRx)
        } yield {
          val missionJsonFlatWriter = createMissionJsonFlatWriter(renderedStacks, solutions)
          Ok(JsArray(missions.map(missionJsonFlatWriter)))
        }
      }
  }

}
