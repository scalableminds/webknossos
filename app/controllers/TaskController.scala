package controllers

import java.io.File

import javax.inject.Inject
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import com.scalableminds.util.mvc.ResultBox
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.tracingstore.SkeletonTracing.{SkeletonTracing, SkeletonTracingOpt, SkeletonTracings}
import com.scalableminds.webknossos.tracingstore.tracings.{ProtoGeometryImplicits, TracingType}
import models.annotation.nml.{NmlResults, NmlService}
import models.annotation.{AnnotationService, TracingStoreService}
import models.binary.{DataSetDAO, DataSetService}
import models.project.ProjectDAO
import models.task._
import models.team.TeamDAO
import models.user._
import net.liftweb.common.Box
import oxalis.security.WkEnv
import com.mohiva.play.silhouette.api.Silhouette
import com.mohiva.play.silhouette.api.actions.{SecuredRequest, UserAwareRequest}
import com.scalableminds.webknossos.tracingstore.VolumeTracing.{VolumeTracing, VolumeTracingOpt, VolumeTracings}
import models.annotation.nml.NmlResults.NmlParseResult
import play.api.libs.Files
import play.api.i18n.{Messages, MessagesApi, MessagesProvider}
import play.api.libs.json._
import play.api.mvc.{MultipartFormData, PlayBodyParsers, Result}
import utils.{ObjectId, WkConf}

import scala.concurrent.{ExecutionContext, Future}

case class TaskParameters(
    taskTypeId: String,
    neededExperience: Experience,
    openInstances: Int,
    projectName: String,
    scriptId: Option[String],
    boundingBox: Option[BoundingBox],
    dataSet: String,
    editPosition: Point3D,
    editRotation: Vector3D,
    creationInfo: Option[String],
    description: Option[String]
)

object TaskParameters {
  implicit val taskParametersFormat: Format[TaskParameters] = Json.format[TaskParameters]
}

case class NmlTaskParameters(taskTypeId: String,
                             neededExperience: Experience,
                             openInstances: Int,
                             projectName: String,
                             scriptId: Option[String],
                             boundingBox: Option[BoundingBox])

object NmlTaskParameters {
  implicit val nmlTaskParametersFormat: Format[NmlTaskParameters] = Json.format[NmlTaskParameters]
}

class TaskController @Inject()(annotationService: AnnotationService,
                               scriptDAO: ScriptDAO,
                               projectDAO: ProjectDAO,
                               taskTypeDAO: TaskTypeDAO,
                               dataSetDAO: DataSetDAO,
                               userService: UserService,
                               dataSetService: DataSetService,
                               tracingStoreService: TracingStoreService,
                               teamDAO: TeamDAO,
                               taskDAO: TaskDAO,
                               taskService: TaskService,
                               nmlService: NmlService,
                               conf: WkConf,
                               sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with ResultBox
    with ProtoGeometryImplicits
    with FoxImplicits {

  val MAX_OPEN_TASKS = conf.WebKnossos.Tasks.maxOpenPerUser

  def read(taskId: String) = sil.SecuredAction.async { implicit request =>
    for {
      task <- taskDAO.findOne(ObjectId(taskId)) ?~> "task.notFound" ~> NOT_FOUND
      js <- taskService.publicWrites(task)
    } yield {
      Ok(js)
    }
  }

  def create = sil.SecuredAction.async(validateJson[List[TaskParameters]]) { implicit request =>
    for {
      _ <- bool2Fox(request.body.length <= 1000) ?~> "task.create.limitExceeded"
      skeletonBaseOpts: List[Option[SkeletonTracing]] <- createTaskSkeletonTracingBases(request.body)
      volumeBaseOpts: List[Option[VolumeTracing]] <- createTaskVolumeTracingBases(request.body,
                                                                                  request.identity._organization)
      result <- createTasks((request.body, skeletonBaseOpts, volumeBaseOpts).zipped.toList)
    } yield result
  }

  def createTaskSkeletonTracingBases(paramsList: List[TaskParameters])(
      implicit ctx: DBAccessContext,
      m: MessagesProvider): Fox[List[Option[SkeletonTracing]]] =
    Fox.serialCombined(paramsList) { params =>
      for {
        taskTypeIdValidated <- ObjectId.parse(params.taskTypeId) ?~> "taskType.id.invalid"
        taskType <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound" ~> NOT_FOUND
        skeletonTracingOpt <- if (taskType.tracingType == TracingType.skeleton || taskType.tracingType == TracingType.hybrid) {
          Fox.successful(
            Some(
              annotationService.createSkeletonTracingBase(
                params.dataSet,
                params.boundingBox,
                params.editPosition,
                params.editRotation
              )))
        } else Fox.successful(None)
      } yield skeletonTracingOpt
    }

  def createTaskVolumeTracingBases(paramsList: List[TaskParameters], organizationId: ObjectId)(
      implicit ctx: DBAccessContext,
      m: MessagesProvider): Fox[List[Option[VolumeTracing]]] =
    Fox.serialCombined(paramsList) { params =>
      for {
        taskTypeIdValidated <- ObjectId.parse(params.taskTypeId) ?~> "taskType.id.invalid"
        taskType <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound" ~> NOT_FOUND
        volumeTracingOpt <- if (taskType.tracingType == TracingType.volume || taskType.tracingType == TracingType.hybrid) {
          annotationService
            .createVolumeTracingBase(
              params.dataSet,
              organizationId,
              params.boundingBox,
              params.editPosition,
              params.editRotation,
              false
            )
            .map(Some(_))
        } else Fox.successful(None)
      } yield volumeTracingOpt
    }

  //Note that from-files tasks do not support volume tracings yet
  @SuppressWarnings(Array("OptionGet")) //We surpress this warning because we know each skeleton exists due to `toSkeletonSuccessFox`
  def createFromFiles = sil.SecuredAction.async { implicit request =>
    for {
      body <- request.body.asMultipartFormData ?~> "binary.payload.invalid"
      inputFiles = body.files.filter(file =>
        file.filename.toLowerCase.endsWith(".nml") || file.filename.toLowerCase.endsWith(".zip"))
      _ <- bool2Fox(inputFiles.length <= 1000) ?~> "task.create.limitExceeded"
      _ <- bool2Fox(inputFiles.nonEmpty) ?~> "nml.file.notFound"
      jsonString <- body.dataParts.get("formJSON").flatMap(_.headOption) ?~> "format.json.missing"
      params <- JsonHelper.parseJsonToFox[NmlTaskParameters](jsonString) ?~> "task.create.failed"
      taskTypeIdValidated <- ObjectId.parse(params.taskTypeId) ?~> "taskType.id.invalid"
      taskType <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound" ~> NOT_FOUND
      _ <- bool2Fox(taskType.tracingType == TracingType.skeleton) ?~> "task.create.fromFileVolume"
      project <- projectDAO
        .findOneByName(params.projectName) ?~> Messages("project.notFound", params.projectName) ~> NOT_FOUND
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team))
      parseResults: List[NmlParseResult] = nmlService
        .extractFromFiles(inputFiles.map(f => (new File(f.ref.path.toString), f.filename)))
        .parseResults
      skeletonSuccesses <- Fox.serialCombined(parseResults)(_.toSkeletonSuccessFox) ?~> "task.create.failed"
      result <- createTasks(skeletonSuccesses.map(s =>
        (buildFullParams(params, s.skeletonTracing.get, s.fileName, s.description), s.skeletonTracing, None)))
    } yield {
      result
    }
  }

  private def buildFullParams(nmlFormParams: NmlTaskParameters,
                              tracing: SkeletonTracing,
                              fileName: String,
                              description: Option[String]) = {
    val parsedNmlTracingBoundingBox = tracing.boundingBox.map(b => BoundingBox(b.topLeft, b.width, b.height, b.depth))
    val bbox = if (nmlFormParams.boundingBox.isDefined) nmlFormParams.boundingBox else parsedNmlTracingBoundingBox
    TaskParameters(
      nmlFormParams.taskTypeId,
      nmlFormParams.neededExperience,
      nmlFormParams.openInstances,
      nmlFormParams.projectName,
      nmlFormParams.scriptId,
      bbox,
      tracing.dataSetName,
      tracing.editPosition,
      tracing.editRotation,
      Some(fileName),
      description
    )
  }

  def createTasks(requestedTasks: List[(TaskParameters, Option[SkeletonTracing], Option[VolumeTracing])])(
      implicit request: SecuredRequest[WkEnv, _]): Fox[Result] = {

    def assertEachHasEitherSkeletonOrVolume: Fox[Boolean] =
      bool2Fox(requestedTasks.forall { tuple =>
        tuple._2.isDefined || tuple._3.isDefined
      })

    def assertAllOnSameDataset(firstDatasetName: String): Fox[String] = {
      def allOnSameDatasetIter(
          requestedTasksRest: List[(TaskParameters, Option[SkeletonTracing], Option[VolumeTracing])],
          dataSetName: String): Boolean =
        requestedTasksRest match {
          case List()       => true
          case head :: tail => head._1.dataSet == dataSetName && allOnSameDatasetIter(tail, dataSetName)
        }

      if (allOnSameDatasetIter(requestedTasks, firstDatasetName))
        Fox.successful(firstDatasetName)
      else
        Fox.failure(Messages("task.notOnSameDataSet"))
    }

    def taskToJsonFoxed(taskFox: Fox[Task], otherFox: Fox[_]): Fox[JsObject] =
      for {
        _ <- otherFox
        task <- taskFox
        js <- taskService.publicWrites(task)
      } yield js

    for {
      _ <- assertEachHasEitherSkeletonOrVolume ?~> "task.create.needsEitherSkeletonOrVolume"
      firstDatasetName <- requestedTasks.headOption.map(_._1.dataSet).toFox
      _ <- assertAllOnSameDataset(firstDatasetName)
      dataSet <- dataSetDAO.findOneByNameAndOrganization(firstDatasetName, request.identity._organization) ?~> Messages(
        "dataSet.notFound",
        firstDatasetName) ~> NOT_FOUND
      tracingStoreClient <- tracingStoreService.clientFor(dataSet)
      skeletonTracingIds: List[Box[Option[String]]] <- tracingStoreClient.saveSkeletonTracings(
        SkeletonTracings(requestedTasks.map(taskTuple => SkeletonTracingOpt(taskTuple._2))))
      volumeTracingIds: List[Box[Option[String]]] <- tracingStoreClient.saveVolumeTracings(
        VolumeTracings(requestedTasks.map(taskTuple => VolumeTracingOpt(taskTuple._3))))
      requestedTasksWithTracingIds = (requestedTasks, skeletonTracingIds, volumeTracingIds).zipped.toList
      taskObjects: List[Fox[Task]] = requestedTasksWithTracingIds.map(r =>
        createTaskWithoutAnnotationBase(r._1._1, r._2, r._3))
      zipped = (requestedTasks, skeletonTracingIds.zip(volumeTracingIds), taskObjects).zipped.toList
      annotationBases = zipped.map(
        tuple =>
          annotationService.createAnnotationBase(
            taskFox = tuple._3,
            request.identity._id,
            skeletonTracingIdBox = tuple._2._1,
            volumeTracingIdBox = tuple._2._2,
            dataSet._id,
            description = tuple._1._1.description
        ))
      zippedTasksAndAnnotations = taskObjects zip annotationBases
      taskJsons = zippedTasksAndAnnotations.map(tuple => taskToJsonFoxed(tuple._1, tuple._2))
      result <- {
        val taskJsonFuture: Future[List[Box[JsObject]]] = Fox.sequence(taskJsons)
        taskJsonFuture.map { taskJsonBoxes =>
          bulk2StatusJson(taskJsonBoxes)
        }
      }
    } yield Ok(Json.toJson(result))
  }

  private def validateScript(scriptIdOpt: Option[String])(implicit request: SecuredRequest[WkEnv, _]): Fox[Unit] =
    scriptIdOpt match {
      case Some(scriptId) =>
        for {
          scriptIdValidated <- ObjectId.parse(scriptId)
          _ <- scriptDAO.findOne(scriptIdValidated) ?~> "script.notFound" ~> NOT_FOUND
        } yield ()
      case _ => Fox.successful(())
    }

  private def createTaskWithoutAnnotationBase(
      params: TaskParameters,
      skeletonTracingIdBox: Box[Option[String]],
      volumeTracingIdBox: Box[Option[String]])(implicit request: SecuredRequest[WkEnv, _]): Fox[Task] =
    for {
      skeletonIdOpt <- skeletonTracingIdBox.toFox
      volumeIdOpt <- volumeTracingIdBox.toFox
      _ <- bool2Fox(skeletonIdOpt.isDefined || volumeIdOpt.isDefined) ?~> "task.create.needsEitherSkeletonOrVolume"
      taskTypeIdValidated <- ObjectId.parse(params.taskTypeId)
      project <- projectDAO.findOneByName(params.projectName) ?~> Messages("project.notFound", params.projectName) ~> NOT_FOUND
      _ <- validateScript(params.scriptId) ?~> "script.invalid"
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team))
      task = Task(
        ObjectId.generate,
        project._id,
        params.scriptId.map(ObjectId(_)),
        taskTypeIdValidated,
        params.neededExperience,
        params.openInstances, //all instances are open at this time
        params.openInstances,
        tracingTime = None,
        boundingBox = params.boundingBox.flatMap { box =>
          if (box.isEmpty) None else Some(box)
        },
        editPosition = params.editPosition,
        editRotation = params.editRotation,
        creationInfo = params.creationInfo
      )
      _ <- taskDAO.insertOne(task)
    } yield task

  def update(taskId: String) = sil.SecuredAction.async(validateJson[TaskParameters]) { implicit request =>
    val params = request.body
    for {
      taskIdValidated <- ObjectId.parse(taskId) ?~> "task.id.invalid"
      task <- taskDAO.findOne(taskIdValidated) ?~> "task.notFound" ~> NOT_FOUND
      project <- projectDAO.findOne(task._project)
      _ <- Fox
        .assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team)) ?~> "notAllowed" ~> FORBIDDEN
      _ <- taskDAO.updateTotalInstances(task._id, task.totalInstances + params.openInstances - task.openInstances)
      updatedTask <- taskDAO.findOne(taskIdValidated)
      json <- taskService.publicWrites(updatedTask)
    } yield {
      JsonOk(json, Messages("task.editSuccess"))
    }
  }

  def delete(taskId: String) = sil.SecuredAction.async { implicit request =>
    for {
      taskIdValidated <- ObjectId.parse(taskId) ?~> "task.id.invalid"
      task <- taskDAO.findOne(taskIdValidated) ?~> "task.notFound" ~> NOT_FOUND
      project <- projectDAO.findOne(task._project)
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team)) ?~> Messages(
        "notAllowed")
      _ <- taskDAO.removeOneAndItsAnnotations(task._id) ?~> "task.remove.failed"
    } yield {
      JsonOk(Messages("task.removed"))
    }
  }

  def listTasksForType(taskTypeId: String) = sil.SecuredAction.async { implicit request =>
    for {
      taskTypeIdValidated <- ObjectId.parse(taskTypeId) ?~> "taskType.id.invalid"
      tasks <- taskDAO.findAllByTaskType(taskTypeIdValidated) ?~> "taskType.notFound" ~> NOT_FOUND
      js <- Fox.serialCombined(tasks)(taskService.publicWrites(_))
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def listTasks = sil.SecuredAction.async(parse.json) { implicit request =>
    for {
      userIdOpt <- Fox.runOptional((request.body \ "user").asOpt[String])(ObjectId.parse)
      projectNameOpt = (request.body \ "project").asOpt[String]
      taskIdsOpt <- Fox.runOptional((request.body \ "ids").asOpt[List[String]])(ids =>
        Fox.serialCombined(ids)(ObjectId.parse))
      taskTypeIdOpt <- Fox.runOptional((request.body \ "taskType").asOpt[String])(ObjectId.parse)
      randomizeOpt = (request.body \ "random").asOpt[Boolean]
      tasks <- taskDAO.findAllByProjectAndTaskTypeAndIdsAndUser(projectNameOpt,
                                                                taskTypeIdOpt,
                                                                taskIdsOpt,
                                                                userIdOpt,
                                                                randomizeOpt)
      jsResult <- Fox.serialCombined(tasks)(taskService.publicWrites(_))
    } yield {
      Ok(Json.toJson(jsResult))
    }
  }

  def request = sil.SecuredAction.async { implicit request =>
    log {
      val user = request.identity
      for {
        teams <- getAllowedTeamsForNextTask(user)
        isTeamManagerOrAdmin <- userService.isTeamManagerOrAdminOfOrg(user, user._organization)
        (task, initializingAnnotationId) <- taskDAO
          .assignNext(user._id, teams, isTeamManagerOrAdmin) ?~> "task.unavailable"
        insertedAnnotationBox <- annotationService.createAnnotationFor(user, task, initializingAnnotationId).futureBox
        _ <- annotationService.abortInitializedAnnotationOnFailure(initializingAnnotationId, insertedAnnotationBox)
        annotation <- insertedAnnotationBox.toFox
        annotationJSON <- annotationService.publicWrites(annotation, Some(user))
      } yield {
        JsonOk(annotationJSON, Messages("task.assigned"))
      }
    }
  }

  private def getAllowedTeamsForNextTask(user: User)(implicit ctx: DBAccessContext,
                                                     m: MessagesProvider): Fox[List[ObjectId]] =
    (for {
      numberOfOpen <- annotationService.countOpenNonAdminTasks(user)
    } yield {
      if (user.isAdmin) {
        teamDAO.findAllIdsByOrganization(user._organization)
      } else if (numberOfOpen < MAX_OPEN_TASKS) {
        userService.teamIdsFor(user._id)
      } else {
        (for {
          teamManagerTeamIds <- userService.teamManagerTeamIdsFor(user._id)
        } yield {
          if (teamManagerTeamIds.nonEmpty) {
            Fox.successful(teamManagerTeamIds)
          } else {
            Fox.failure(Messages("task.tooManyOpenOnes"))
          }
        }).flatten
      }
    }).flatten

  def peekNext = sil.SecuredAction.async { implicit request =>
    val user = request.identity
    for {
      teamIds <- userService.teamIdsFor(user._id)
      isTeamManagerOrAdmin <- userService.isTeamManagerOrAdminOfOrg(user, user._organization)
      task <- taskDAO.peekNextAssignment(user._id, teamIds, isTeamManagerOrAdmin) ?~> "task.unavailable"
      taskJson <- taskService.publicWrites(task)(GlobalAccessContext)
    } yield Ok(taskJson)
  }

  def listExperienceDomains = sil.SecuredAction.async { implicit request =>
    for {
      experienceDomains <- taskDAO.listExperienceDomains
    } yield Ok(Json.toJson(experienceDomains))
  }
}
