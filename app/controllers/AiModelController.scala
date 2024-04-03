package controllers

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.aimodels.{AiInference, AiInferenceDAO, AiInferenceService, AiModel, AiModelDAO, AiModelService}
import models.annotation.AnnotationDAO
import models.dataset.{DataStoreDAO, DatasetDAO}
import models.job.{JobCommand, JobService}
import models.user.UserService
import play.api.libs.json.{Json, OFormat}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import play.silhouette.api.Silhouette
import security.WkEnv
import utils.ObjectId

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import com.scalableminds.util.time.Instant
import models.aimodels.AiModelCategory.AiModelCategory

case class TrainingAnnotationSpecification(annotationId: ObjectId,
                                           colorLayerName: String,
                                           segmentationLayerName: String,
                                           mag: Vec3Int)

object TrainingAnnotationSpecification {
  implicit val jsonFormat: OFormat[TrainingAnnotationSpecification] = Json.format[TrainingAnnotationSpecification]
}

case class RunTrainingParameters(trainingAnnotations: List[TrainingAnnotationSpecification],
                                 name: String,
                                 comment: Option[String],
                                 aiModelCategory: Option[AiModelCategory],
                                 workflowYaml: Option[String])

object RunTrainingParameters {
  implicit val jsonFormat: OFormat[RunTrainingParameters] = Json.format[RunTrainingParameters]
}

case class RunInferenceParameters(annotationId: ObjectId,
                                  aiModelId: ObjectId,
                                  newSegmentationLayerName: String,
                                  maskAnnotationLayerName: Option[String])

object RunInferenceParameters {
  implicit val jsonFormat: OFormat[RunInferenceParameters] = Json.format[RunInferenceParameters]
}

case class UpdateAiModelParameters(name: String, comment: Option[String])

object UpdateAiModelParameters {
  implicit val jsonFormat: OFormat[UpdateAiModelParameters] = Json.format[UpdateAiModelParameters]
}

class AiModelController @Inject()(
    aiModelDAO: AiModelDAO,
    aiModelService: AiModelService,
    sil: Silhouette[WkEnv],
    userService: UserService,
    annotationDAO: AnnotationDAO,
    aiInferenceService: AiInferenceService,
    aiInferenceDAO: AiInferenceDAO,
    jobService: JobService,
    datasetDAO: DatasetDAO,
    dataStoreDAO: DataStoreDAO)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  def readAiModelInfo(aiModelId: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    {
      for {
        _ <- userService.assertIsSuperUser(request.identity)
        aiModelIdValidated <- ObjectId.fromString(aiModelId)
        aiModel <- aiModelDAO.findOne(aiModelIdValidated) ?~> "aiModel.notFound" ~> NOT_FOUND
        jsResult <- aiModelService.publicWrites(aiModel)
      } yield Ok(jsResult)
    }
  }

  def readAiInferenceInfo(aiInferenceId: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    {
      for {
        _ <- userService.assertIsSuperUser(request.identity)
        aiInferenceIdValidated <- ObjectId.fromString(aiInferenceId)
        aiInference <- aiInferenceDAO.findOne(aiInferenceIdValidated) ?~> "aiInference.notFound" ~> NOT_FOUND
        jsResult <- aiInferenceService.publicWrites(aiInference)
      } yield Ok(jsResult)
    }
  }

  def listAiModels: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    {
      for {
        _ <- userService.assertIsSuperUser(request.identity)
        aiModels <- aiModelDAO.findAll
        jsResults <- Fox.serialCombined(aiModels)(aiModelService.publicWrites)
      } yield Ok(Json.toJson(jsResults))
    }
  }

  def listAiInferences: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    {
      for {
        _ <- userService.assertIsSuperUser(request.identity)
        aiInferences <- aiInferenceDAO.findAll
        jsResults <- Fox.serialCombined(aiInferences)(aiInferenceService.publicWrites)
      } yield Ok(Json.toJson(jsResults))
    }
  }

  def runTraining: Action[RunTrainingParameters] = sil.SecuredAction.async(validateJson[RunTrainingParameters]) {
    implicit request =>
      for {
        _ <- userService.assertIsSuperUser(request.identity)
        trainingAnnotations = request.body.trainingAnnotations
        // TODO if full yaml is supplied, relax this check
        _ <- bool2Fox(trainingAnnotations.nonEmpty) ?~> "aiModel.training.zeroAnnotations"
        firstAnnotationId <- trainingAnnotations.headOption.map(_.annotationId).toFox
        annotation <- annotationDAO.findOne(firstAnnotationId)
        dataset <- datasetDAO.findOne(annotation._dataset)
        dataStore <- dataStoreDAO.findOneByName(dataset._dataStore) ?~> "dataStore.notFound"
        _ <- Fox
          .serialCombined(request.body.trainingAnnotations.map(_.annotationId))(annotationDAO.findOne) ?~> "annotation.notFound"
        jobCommand = JobCommand.train_model
        commandArgs = Json.obj("training_annotations" -> Json.toJson(trainingAnnotations))
        newTrainingJob <- jobService
          .submitJob(jobCommand, commandArgs, request.identity, dataStore.name) ?~> "job.couldNotRunTrainModel"
        existingAiModelsCount <- aiModelDAO.countByNameAndOrganization(request.body.name,
                                                                       request.identity._organization)
        _ <- bool2Fox(existingAiModelsCount == 0) ?~> "model.nameInUse"
        newAiModel = AiModel(
          _id = ObjectId.generate,
          _organization = request.identity._organization,
          _dataStore = dataStore.name,
          _user = request.identity._id,
          _trainingJob = Some(newTrainingJob._id),
          _trainingAnnotations = trainingAnnotations.map(_.annotationId),
          name = request.body.name,
          comment = request.body.comment
        )
        _ <- aiModelDAO.insertOne(newAiModel)
        newAiModelJs <- aiModelService.publicWrites(newAiModel)
      } yield Ok(newAiModelJs)
  }

  def runInference: Action[RunInferenceParameters] =
    sil.SecuredAction.async(validateJson[RunInferenceParameters]) { implicit request =>
      for {
        _ <- userService.assertIsSuperUser(request.identity)
        annotation <- annotationDAO.findOne(request.body.annotationId)
        dataset <- datasetDAO.findOne(annotation._dataset)
        dataStore <- dataStoreDAO.findOneByName(dataset._dataStore) ?~> "dataStore.notFound"
        jobCommand = JobCommand.infer_with_model
        commandArgs = Json.obj("annotation" -> annotation._id)
        newInferenceJob <- jobService.submitJob(jobCommand, commandArgs, request.identity, dataStore.name) ?~> "job.couldNotRunInferWithModel"
        newAiInference = AiInference(
          _id = ObjectId.generate,
          _organization = request.identity._organization,
          _aiModel = request.body.aiModelId,
          _dataset = None,
          _annotation = annotation._id,
          _inferenceJob = newInferenceJob._id,
          newSegmentationLayerName = request.body.newSegmentationLayerName,
          maskAnnotationLayerName = request.body.maskAnnotationLayerName
        )
        _ <- aiInferenceDAO.insertOne(newAiInference)
        newAiModelJs <- aiInferenceService.publicWrites(newAiInference)
      } yield Ok(newAiModelJs)
    }

  def updateAiModelInfo(aiModelId: String): Action[UpdateAiModelParameters] =
    sil.SecuredAction.async(validateJson[UpdateAiModelParameters]) { implicit request =>
      {
        for {
          _ <- userService.assertIsSuperUser(request.identity)
          aiModelIdValidated <- ObjectId.fromString(aiModelId)
          aiModel <- aiModelDAO.findOne(aiModelIdValidated) ?~> "aiModel.notFound" ~> NOT_FOUND
          _ <- aiModelDAO.updateOne(
            aiModel.copy(name = request.body.name, comment = request.body.comment, modified = Instant.now))
          updatedAiModel <- aiModelDAO.findOne(aiModelIdValidated) ?~> "aiModel.notFound" ~> NOT_FOUND
          jsResult <- aiModelService.publicWrites(updatedAiModel)
        } yield Ok(jsResult)
      }
    }

}
