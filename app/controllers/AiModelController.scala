package controllers

import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.aimodels.{AiInference, AiInferenceDAO, AiInferenceService, AiModel, AiModelDAO, AiModelService}
import models.annotation.AnnotationDAO
import models.dataset.{DataStoreDAO, DatasetDAO, DatasetService}
import models.job.{JobCommand, JobService}
import models.user.UserService
import play.api.libs.json.{Json, OFormat}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import play.silhouette.api.Silhouette
import security.WkEnv
import com.scalableminds.util.objectid.ObjectId

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import com.scalableminds.util.time.Instant
import models.aimodels.AiModelCategory.AiModelCategory
import models.organization.OrganizationDAO
import play.api.i18n.Messages

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

case class RunInferenceParameters(annotationId: Option[ObjectId],
                                  aiModelId: ObjectId,
                                  datasetDirectoryName: String,
                                  organizationId: String,
                                  colorLayerName: String,
                                  boundingBox: String,
                                  newDatasetName: String,
                                  maskAnnotationLayerName: Option[String],
                                  workflowYaml: Option[String])

object RunInferenceParameters {
  implicit val jsonFormat: OFormat[RunInferenceParameters] = Json.format[RunInferenceParameters]
}

case class UpdateAiModelParameters(name: String, comment: Option[String])

object UpdateAiModelParameters {
  implicit val jsonFormat: OFormat[UpdateAiModelParameters] = Json.format[UpdateAiModelParameters]
}

case class RegisterAiModelParameters(id: ObjectId, // must be a valid MongoDB ObjectId
                                     dataStoreName: String,
                                     name: String,
                                     comment: Option[String],
                                     category: Option[AiModelCategory])

object RegisterAiModelParameters {
  implicit val jsonFormat: OFormat[RegisterAiModelParameters] = Json.format[RegisterAiModelParameters]
}

class AiModelController @Inject()(
    aiModelDAO: AiModelDAO,
    aiModelService: AiModelService,
    sil: Silhouette[WkEnv],
    userService: UserService,
    annotationDAO: AnnotationDAO,
    aiInferenceService: AiInferenceService,
    aiInferenceDAO: AiInferenceDAO,
    organizationDAO: OrganizationDAO,
    datasetService: DatasetService,
    jobService: JobService,
    datasetDAO: DatasetDAO,
    dataStoreDAO: DataStoreDAO)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  def readAiModelInfo(aiModelId: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    {
      for {
        _ <- userService.assertIsSuperUser(request.identity)
        aiModel <- aiModelDAO.findOne(aiModelId) ?~> "aiModel.notFound" ~> NOT_FOUND
        jsResult <- aiModelService.publicWrites(aiModel)
      } yield Ok(jsResult)
    }
  }

  def readAiInferenceInfo(aiInferenceId: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    {
      for {
        _ <- userService.assertIsSuperUser(request.identity)
        aiInference <- aiInferenceDAO.findOne(aiInferenceId) ?~> "aiInference.notFound" ~> NOT_FOUND
        jsResult <- aiInferenceService.publicWrites(aiInference, request.identity)
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
        jsResults <- Fox.serialCombined(aiInferences)(inference =>
          aiInferenceService.publicWrites(inference, request.identity))
      } yield Ok(Json.toJson(jsResults))
    }
  }

  def runTraining: Action[RunTrainingParameters] = sil.SecuredAction.async(validateJson[RunTrainingParameters]) {
    implicit request =>
      for {
        _ <- userService.assertIsSuperUser(request.identity)
        trainingAnnotations = request.body.trainingAnnotations
        _ <- bool2Fox(trainingAnnotations.nonEmpty || request.body.workflowYaml.isDefined) ?~> "aiModel.training.zeroAnnotations"
        firstAnnotationId <- trainingAnnotations.headOption.map(_.annotationId).toFox
        annotation <- annotationDAO.findOne(firstAnnotationId)
        dataset <- datasetDAO.findOne(annotation._dataset)
        _ <- bool2Fox(request.identity._organization == dataset._organization) ?~> "job.trainModel.notAllowed.organization" ~> FORBIDDEN
        dataStore <- dataStoreDAO.findOneByName(dataset._dataStore) ?~> "dataStore.notFound"
        _ <- Fox
          .serialCombined(request.body.trainingAnnotations.map(_.annotationId))(annotationDAO.findOne) ?~> "annotation.notFound"
        modelId = ObjectId.generate
        organization <- organizationDAO.findOne(request.identity._organization)
        jobCommand = JobCommand.train_model
        commandArgs = Json.obj(
          "training_annotations" -> Json.toJson(trainingAnnotations),
          "organization_id" -> organization._id,
          "model_id" -> modelId,
          "custom_workflow_provided_by_user" -> request.body.workflowYaml
        )
        existingAiModelsCount <- aiModelDAO.countByNameAndOrganization(request.body.name,
                                                                       request.identity._organization)
        _ <- bool2Fox(existingAiModelsCount == 0) ?~> "aiModel.nameInUse"
        newTrainingJob <- jobService
          .submitJob(jobCommand, commandArgs, request.identity, dataStore.name) ?~> "job.couldNotRunTrainModel"
        newAiModel = AiModel(
          _id = modelId,
          _organization = request.identity._organization,
          _dataStore = dataStore.name,
          _user = request.identity._id,
          _trainingJob = Some(newTrainingJob._id),
          _trainingAnnotations = trainingAnnotations.map(_.annotationId),
          name = request.body.name,
          comment = request.body.comment,
          category = request.body.aiModelCategory
        )
        _ <- aiModelDAO.insertOne(newAiModel)
        newAiModelJs <- aiModelService.publicWrites(newAiModel)
      } yield Ok(newAiModelJs)
  }

  def runInference: Action[RunInferenceParameters] =
    sil.SecuredAction.async(validateJson[RunInferenceParameters]) { implicit request =>
      for {
        _ <- userService.assertIsSuperUser(request.identity)
        organization <- organizationDAO.findOne(request.body.organizationId)(GlobalAccessContext) ?~> Messages(
          "organization.notFound",
          request.body.organizationId)
        _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.runInference.notAllowed.organization" ~> FORBIDDEN
        dataset <- datasetDAO.findOneByDirectoryNameAndOrganization(request.body.datasetDirectoryName, organization._id)
        dataStore <- dataStoreDAO.findOneByName(dataset._dataStore) ?~> "dataStore.notFound"
        _ <- aiModelDAO.findOne(request.body.aiModelId) ?~> "aiModel.notFound"
        _ <- datasetService.assertValidDatasetName(request.body.newDatasetName)
        jobCommand = JobCommand.infer_with_model
        boundingBox <- BoundingBox.fromLiteral(request.body.boundingBox).toFox
        commandArgs = Json.obj(
          "dataset_id" -> dataset._id,
          "organization_id" -> organization._id,
          "dataset_name" -> dataset.name,
          "color_layer_name" -> request.body.colorLayerName,
          "bounding_box" -> boundingBox.toLiteral,
          "model_id" -> request.body.aiModelId,
          "dataset_directory_name" -> request.body.datasetDirectoryName,
          "new_dataset_name" -> request.body.newDatasetName,
          "custom_workflow_provided_by_user" -> request.body.workflowYaml
        )
        newInferenceJob <- jobService.submitJob(jobCommand, commandArgs, request.identity, dataStore.name) ?~> "job.couldNotRunInferWithModel"
        newAiInference = AiInference(
          _id = ObjectId.generate,
          _organization = request.identity._organization,
          _aiModel = request.body.aiModelId,
          _newDataset = None,
          _annotation = request.body.annotationId,
          boundingBox = boundingBox,
          _inferenceJob = newInferenceJob._id,
          newSegmentationLayerName = "segmentation",
          maskAnnotationLayerName = request.body.maskAnnotationLayerName
        )
        _ <- aiInferenceDAO.insertOne(newAiInference)
        newAiModelJs <- aiInferenceService.publicWrites(newAiInference, request.identity)
      } yield Ok(newAiModelJs)
    }

  def updateAiModelInfo(aiModelId: ObjectId): Action[UpdateAiModelParameters] =
    sil.SecuredAction.async(validateJson[UpdateAiModelParameters]) { implicit request =>
      for {
        _ <- userService.assertIsSuperUser(request.identity)
        aiModel <- aiModelDAO.findOne(aiModelId) ?~> "aiModel.notFound" ~> NOT_FOUND
        _ <- aiModelDAO.updateOne(
          aiModel.copy(name = request.body.name, comment = request.body.comment, modified = Instant.now))
        updatedAiModel <- aiModelDAO.findOne(aiModelId) ?~> "aiModel.notFound" ~> NOT_FOUND
        jsResult <- aiModelService.publicWrites(updatedAiModel)
      } yield Ok(jsResult)
    }

  def registerAiModel: Action[RegisterAiModelParameters] =
    sil.SecuredAction.async(validateJson[RegisterAiModelParameters]) { implicit request =>
      for {
        _ <- userService.assertIsSuperUser(request.identity)
        _ <- dataStoreDAO.findOneByName(request.body.dataStoreName) ?~> "dataStore.notFound"
        _ <- aiModelDAO.findOne(request.body.id).reverse ?~> "aiModel.id.taken"
        _ <- aiModelDAO.findOneByName(request.body.name).reverse ?~> "aiModel.name.taken"
        _ <- aiModelDAO.insertOne(
          AiModel(
            request.body.id,
            _organization = request.identity._organization,
            request.body.dataStoreName,
            request.identity._id,
            None,
            List.empty,
            request.body.name,
            request.body.comment,
            request.body.category
          ))
      } yield Ok
    }

  def deleteAiModel(aiModelId: ObjectId): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- userService.assertIsSuperUser(request.identity)
        referencesCount <- aiInferenceDAO.countForModel(aiModelId)
        _ <- bool2Fox(referencesCount == 0) ?~> "aiModel.delete.referencedByInferences"
        _ <- aiModelDAO.findOne(aiModelId) ?~> "aiModel.notFound" ~> NOT_FOUND
        _ <- aiModelDAO.deleteOne(aiModelId)
      } yield Ok
    }

}
