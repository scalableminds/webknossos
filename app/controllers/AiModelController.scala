package controllers

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.aimodels.{AiModelDAO, AiModelService}
import play.api.mvc.{Action, AnyContent}
import play.silhouette.api.Silhouette
import security.WkEnv
import utils.ObjectId

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class AiModelController @Inject()(aiModelDAO: AiModelDAO, aiModelService: AiModelService, sil: Silhouette[WkEnv])(
    implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  def readModelInfo(aiModelId: String): Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    {
      for {
        aiModelIdValidated <- ObjectId.fromString(aiModelId)
        aiModel <- aiModelDAO.findOne(aiModelIdValidated) ?~> "aiModel.notFound" ~> NOT_FOUND
        jsResult <- aiModelService.publicWrites(aiModel)
      } yield Ok(jsResult)
    }
  }

  def runTraining: Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    Fox.successful(Ok("run training"))
  }

}
