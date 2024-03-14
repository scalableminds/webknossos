package controllers

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.aimodels.{AiModel, AiModelDAO, AiModelService}
import models.annotation.AnnotationDAO
import models.dataset.DataStoreDAO
import models.job.{JobCommand, JobService}
import models.user.UserService
import play.api.libs.json.{Json, OFormat}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import play.silhouette.api.Silhouette
import security.WkEnv
import utils.ObjectId

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class RunTrainingParameters(trainingAnnotationIds: List[ObjectId],
                                 name: String,
                                 comment: String,
                                 dataStoreName: String,
                                 workflow_yaml: Option[String])

object RunTrainingParameters {
  implicit val jsonFormat: OFormat[RunTrainingParameters] = Json.format[RunTrainingParameters]
}

class AiModelController @Inject()(
    aiModelDAO: AiModelDAO,
    aiModelService: AiModelService,
    sil: Silhouette[WkEnv],
    userService: UserService,
    annotationDAO: AnnotationDAO,
    jobService: JobService,
    dataStoreDAO: DataStoreDAO)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
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

  def runTraining: Action[RunTrainingParameters] = sil.SecuredAction.async(validateJson[RunTrainingParameters]) {
    implicit request =>
      for {
        _ <- userService.assertIsSuperUser(request.identity)
        _ <- bool2Fox(request.body.trainingAnnotationIds.nonEmpty) ?~> "aiModel.training.zeroAnnotations"
        dataStore <- dataStoreDAO.findOneByName(request.body.dataStoreName) ?~> "dataStore.notFound"
        trainingAnnotations <- Fox.serialCombined(request.body.trainingAnnotationIds)(annotationDAO.findOne)
        jobCommand = JobCommand.train_model
        commandArgs = Json.obj("training_annotations" -> trainingAnnotations.map(_._id).mkString(","))
        newTrainingJob <- jobService
          .submitJob(jobCommand, commandArgs, request.identity, dataStore.name) ?~> "job.couldNotRunTrainModel"
        newAiModel = AiModel(
          _id = ObjectId.generate,
          _organization = request.identity._organization,
          _dataStore = request.body.dataStoreName,
          _user = request.identity._id,
          _trainingJob = Some(newTrainingJob._id),
          _trainingAnnotations = trainingAnnotations.map(_._id),
          name = request.body.name,
          comment = request.body.comment
        )
        _ <- aiModelDAO.insertOne(newAiModel)
        newAiModelJs <- aiModelService.publicWrites(newAiModel)
      } yield Ok(newAiModelJs)
  }

}
