package controllers

import javax.inject.Inject

import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import com.scalableminds.util.mvc.ResultBox
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonTracings}
import com.scalableminds.webknossos.datastore.tracings.ProtoGeometryImplicits
import models.annotation.nml.NmlService
import models.annotation.AnnotationService
import models.binary.{DataSetDAO, DataSetService}
import models.project.ProjectDAO
import models.task._
import models.team.TeamDAO
import models.user._
import net.liftweb.common.Box
import oxalis.security.WebknossosSilhouette
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import play.api.mvc.Result
import utils.{ObjectId, WkConf}

import scala.concurrent.Future

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

case class NmlTaskParameters(
                              taskTypeId: String,
                              neededExperience: Experience,
                              openInstances: Int,
                              projectName: String,
                              scriptId: Option[String],
                              boundingBox: Option[BoundingBox])

object NmlTaskParameters {
  implicit val nmlTaskParametersFormat: Format[NmlTaskParameters] = Json.format[NmlTaskParameters]
}

class TaskController @Inject() (annotationService: AnnotationService,
                                scriptDAO: ScriptDAO,
                                projectDAO: ProjectDAO,
                                taskTypeDAO: TaskTypeDAO,
                                dataSetDAO: DataSetDAO,
                                userService: UserService,
                                dataSetService: DataSetService,
                                teamDAO: TeamDAO,
                                taskDAO: TaskDAO,
                                taskService: TaskService,
                                sil: WebknossosSilhouette,
                                val messagesApi: MessagesApi)
  extends Controller
    with ResultBox
    with ProtoGeometryImplicits
    with FoxImplicits {

  implicit def userAwareRequestToDBAccess(implicit request: sil.UserAwareRequest[_]) = DBAccessContext(request.identity)
  implicit def securedRequestToDBAccess(implicit request: sil.SecuredRequest[_]) = DBAccessContext(Some(request.identity))

  val MAX_OPEN_TASKS = WkConf.Oxalis.Tasks.maxOpenPerUser

  def read(taskId: String) = sil.SecuredAction.async { implicit request =>
    for {
      task <- taskDAO.findOne(ObjectId(taskId)) ?~> "task.notFound"
      js <- taskService.publicWrites(task)
    } yield {
      Ok(js)
    }
  }


  def create = sil.SecuredAction.async(validateJson[List[TaskParameters]]) { implicit request =>
    createTasks(request.body.map { params =>
      val tracing = annotationService.createTracingBase(params.dataSet, params.boundingBox, params.editPosition, params.editRotation)
      (params, tracing)
    })
  }

  def createFromFile = sil.SecuredAction.async { implicit request =>
    for {
      body <- request.body.asMultipartFormData ?~> "binary.payload.invalid"
      inputFile <- body.file("nmlFile[]") ?~> "nml.file.notFound"
      jsonString <- body.dataParts.get("formJSON").flatMap(_.headOption) ?~> "format.json.missing"
      params <- JsonHelper.parseJsonToFox[NmlTaskParameters](jsonString) ?~> "task.create.failed"
      taskTypeIdValidated <- ObjectId.parse(params.taskTypeId) ?~> "taskType.id.invalid"
      taskType <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound"
      project <- projectDAO.findOneByName(params.projectName) ?~> Messages("project.notFound", params.projectName)
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team))
      parseResults: List[NmlService.NmlParseResult] = NmlService.extractFromFile(inputFile.ref.file, inputFile.filename).parseResults
      skeletonSuccesses <- Fox.serialCombined(parseResults)(_.toSkeletonSuccessFox) ?~> "task.create.failed"
      result <- createTasks(skeletonSuccesses.map(s => (buildFullParams(params, s.skeletonTracing.get, s.fileName, s.description), s.skeletonTracing.get)))
    } yield {
      result
    }
  }

  private def buildFullParams(nmlFormParams: NmlTaskParameters, tracing: SkeletonTracing, fileName: String, description: Option[String]) = {
    val parsedNmlTracingBoundingBox = tracing.boundingBox.map(b => BoundingBox(b.topLeft, b.width, b.height, b.depth))
    val bbox = if(nmlFormParams.boundingBox.isDefined) nmlFormParams.boundingBox else parsedNmlTracingBoundingBox
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

  def createTasks(requestedTasks: List[(TaskParameters, SkeletonTracing)])(implicit request: sil.SecuredRequest[_]): Fox[Result] = {
    def assertAllOnSameDataset: Fox[String] = {
      def allOnSameDatasetIter(requestedTasksRest: List[(TaskParameters, SkeletonTracing)], dataSetName: String): Boolean = {
        requestedTasksRest match {
          case List() => true
          case head :: tail => head._1.dataSet == dataSetName && allOnSameDatasetIter(tail, dataSetName)
        }
      }

      val firstDataSetName = requestedTasks.head._1.dataSet
      if (allOnSameDatasetIter(requestedTasks, firstDataSetName))
        Fox.successful(firstDataSetName)
      else
        Fox.failure("Cannot create tasks on multiple datasets in one go.")
    }

    def taskToJsonFoxed(taskFox: Fox[Task], otherFox: Fox[_]): Fox[JsObject] = {
      for {
        _ <- otherFox
        task <- taskFox
        js <- taskService.publicWrites(task)
      } yield js
    }

    for {
      dataSetName <- assertAllOnSameDataset
      taskType <- taskTypeDAO.findOne(ObjectId(requestedTasks.head._1.taskTypeId))
      team <- teamDAO.findOne(taskType._team)
      dataSet <- dataSetDAO.findOneByNameAndOrganization(requestedTasks.head._1.dataSet, team._organization) ?~> Messages("dataSet.notFound", dataSetName)
      dataStoreHandler <- dataSetService.handlerFor(dataSet)
      skeletonTracingIds: List[Box[String]] <- dataStoreHandler.saveSkeletonTracings(SkeletonTracings(requestedTasks.map(_._2)))
      requestedTasksWithTracingIds = requestedTasks zip skeletonTracingIds
      taskObjects: List[Fox[Task]] = requestedTasksWithTracingIds.map(r => createTaskWithoutAnnotationBase(r._1._1, r._2))
      zipped = (requestedTasks, skeletonTracingIds, taskObjects).zipped.toList
      annotationBases = zipped.map(tuple => annotationService.createAnnotationBase(
        taskFox = tuple._3,
        request.identity._id,
        skeletonTracingIdBox = tuple._2,
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

  private def validateScript(scriptIdOpt: Option[String])(implicit request: sil.SecuredRequest[_]): Fox[Unit] = {
    scriptIdOpt match {
      case Some(scriptId) =>
        for {
          scriptIdValidated <- ObjectId.parse(scriptId)
          _ <- scriptDAO.findOne(scriptIdValidated) ?~> "script.notFound"
        } yield ()
      case _ => Fox.successful(())
    }
  }

  private def createTaskWithoutAnnotationBase(params: TaskParameters, skeletonTracingIdBox: Box[String])(implicit request: sil.SecuredRequest[_]): Fox[Task] = {
    for {
      _ <- skeletonTracingIdBox.toFox
      taskTypeIdValidated <- ObjectId.parse(params.taskTypeId)
      taskType <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound"
      project <- projectDAO.findOneByName(params.projectName) ?~> Messages("project.notFound", params.projectName)
      _ <- validateScript(params.scriptId) ?~> "script.invalid"
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team))
      task = Task(
        ObjectId.generate,
        project._id,
        params.scriptId.map(ObjectId(_)),
        taskType._id,
        params.neededExperience,
        params.openInstances, //all instances are open at this time
        params.openInstances,
        tracingTime = None,
        boundingBox = params.boundingBox.flatMap { box => if (box.isEmpty) None else Some(box) },
        editPosition = params.editPosition,
        editRotation = params.editRotation,
        creationInfo = params.creationInfo
      )
      _ <- taskDAO.insertOne(task)
    } yield task
  }


  def update(taskId: String) = sil.SecuredAction.async(validateJson[TaskParameters]) { implicit request =>
    val params = request.body
    for {
      taskIdValidated <- ObjectId.parse(taskId) ?~> "task.id.invalid"
      task <- taskDAO.findOne(taskIdValidated) ?~> "task.notFound"
      project <- projectDAO.findOne(task._project)
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team)) ?~> "notAllowed"
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
      task <- taskDAO.findOne(taskIdValidated) ?~> "task.notFound"
      project <- projectDAO.findOne(task._project)
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team)) ?~> Messages("notAllowed")
      _ <- taskDAO.removeOneAndItsAnnotations(task._id) ?~> "task.remove.failed"
    } yield {
      JsonOk(Messages("task.removed"))
    }
  }

  def listTasksForType(taskTypeId: String) = sil.SecuredAction.async { implicit request =>
    for {
      taskTypeIdValidated <- ObjectId.parse(taskTypeId) ?~> "taskType.id.invalid"
      tasks <- taskDAO.findAllByTaskType(taskTypeIdValidated) ?~> "taskType.notFound"
      js <- Fox.serialCombined(tasks)(taskService.publicWrites(_))
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def listTasks = sil.SecuredAction.async(parse.json) { implicit request =>

    for {
      userIdOpt <- Fox.runOptional((request.body \ "user").asOpt[String])(ObjectId.parse)
      projectNameOpt = (request.body \ "project").asOpt[String]
      taskIdsOpt <- Fox.runOptional((request.body \ "ids").asOpt[List[String]])(ids => Fox.serialCombined(ids)(ObjectId.parse))
      taskTypeIdOpt <- Fox.runOptional((request.body \ "taskType").asOpt[String])(ObjectId.parse)
      randomizeOpt = (request.body \ "random").asOpt[Boolean]
      tasks <- taskDAO.findAllByProjectAndTaskTypeAndIdsAndUser(projectNameOpt, taskTypeIdOpt, taskIdsOpt, userIdOpt, randomizeOpt)
      jsResult <- Fox.serialCombined(tasks)(taskService.publicWrites(_))
    } yield {
      Ok(Json.toJson(jsResult))
    }
  }

  def request = sil.SecuredAction.async { implicit request =>
    val user = request.identity
    for {
      teams <- getAllowedTeamsForNextTask(user)
      (task, initializingAnnotationId) <- taskDAO.assignNext(user._id, teams) ?~> "task.unavailable"
      insertedAnnotationBox <- annotationService.createAnnotationFor(user, task, initializingAnnotationId).futureBox
      _ <- annotationService.abortInitializedAnnotationOnFailure(initializingAnnotationId, insertedAnnotationBox)
      annotation <- insertedAnnotationBox.toFox
      annotationJSON <- annotationService.publicWrites(annotation, Some(user))
    } yield {
      JsonOk(annotationJSON, Messages("task.assigned"))
    }
  }


  private def getAllowedTeamsForNextTask(user: User)(implicit ctx: DBAccessContext): Fox[List[ObjectId]] = {
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
  }

  def peekNext = sil.SecuredAction.async { implicit request =>
    val user = request.identity
    for {
      teamIds <- userService.teamIdsFor(user._id)
      task <- taskDAO.peekNextAssignment(user._id, teamIds) ?~> "task.unavailable"
      taskJson <- taskService.publicWrites(task)(GlobalAccessContext)
    } yield Ok(taskJson)
  }


  def listExperienceDomains = sil.SecuredAction.async { implicit request =>
    for {
      experienceDomains <- taskDAO.listExperienceDomains
    } yield Ok(Json.toJson(experienceDomains))
  }
}
