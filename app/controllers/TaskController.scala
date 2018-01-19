package controllers

import java.util.UUID
import javax.inject.Inject

import com.newrelic.api.agent.NewRelic
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonTracings}
import com.scalableminds.webknossos.datastore.tracings.{ProtoGeometryImplicits, TracingReference}
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper, TimeLogger}
import models.annotation.nml.NmlService
import models.annotation.{AnnotationDAO, AnnotationService, AnnotationType}
import models.binary.DataSetDAO
import models.project.ProjectDAO
import models.task._
import models.user._
import net.liftweb.common.{Box, Empty, Failure, Full}
import oxalis.security.WebknossosSilhouette.{SecuredAction, SecuredRequest}
import play.api.Play.current
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import play.api.mvc.Result
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONObjectIDFormat

import scala.concurrent.Future
import scala.util.Success

case class TaskParameters(
                           taskTypeId: String,
                           neededExperience: Experience,
                           openInstances: Int,
                           team: BSONObjectID,
                           projectName: String,
                           scriptId: Option[String],
                           boundingBox: Option[BoundingBox],
                           dataSet: String,
                           editPosition: Point3D,
                           editRotation: Vector3D)

object TaskParameters {
  implicit val taskParametersFormat: Format[TaskParameters] = Json.format[TaskParameters]
}

case class NmlTaskParameters(
                              taskTypeId: String,
                              neededExperience: Experience,
                              openInstances: Int,
                              team: BSONObjectID,
                              projectName: String,
                              scriptId: Option[String],
                              boundingBox: Option[BoundingBox])

object NmlTaskParameters {
  implicit val nmlTaskParametersFormat: Format[NmlTaskParameters] = Json.format[NmlTaskParameters]
}

class TaskController @Inject()(val messagesApi: MessagesApi) extends Controller with ProtoGeometryImplicits with FoxImplicits {

  val MAX_OPEN_TASKS = current.configuration.getInt("oxalis.tasks.maxOpenPerUser") getOrElse 2

  def read(taskId: String) = SecuredAction.async { implicit request =>
    for {
      task <- TaskService.findOneById(taskId) ?~> Messages("task.notFound")
      js <- Task.transformToJson(task)
    } yield {
      Ok(js)
    }
  }


  def create = SecuredAction.async(validateJson[List[TaskParameters]]) { implicit request =>
    createTasks(request.body.map { params =>
      val tracing = AnnotationService.createTracingBase(params.dataSet, params.boundingBox, params.editPosition, params.editRotation)
      (params, tracing)
    })
  }

  def createFromFile = SecuredAction.async { implicit request =>

    for {
      body <- request.body.asMultipartFormData ?~> Messages("invalid")
      inputFile <- body.file("nmlFile[]") ?~> Messages("nml.file.notFound")
      jsonString <- body.dataParts.get("formJSON").flatMap(_.headOption) ?~> Messages("format.json.missing")
      params <- JsonHelper.parseJsonToFox[NmlTaskParameters](jsonString) ?~> Messages("task.create.failed")
      taskType <- TaskTypeDAO.findOneById(params.taskTypeId) ?~> Messages("taskType.notFound")
      project <- ProjectDAO.findOneByName(params.projectName) ?~> Messages("project.notFound", params.projectName)
      _ <- ensureTeamAdministration(request.identity, params.team)

      parseResults: List[NmlService.NmlParseResult] = NmlService.extractFromFile(inputFile.ref.file, inputFile.filename).parseResults
      tracingFoxes = parseResults.map(parseResultToSkeletonTracingFox)
      tracings <- Fox.combined(tracingFoxes) ?~> Messages("task.create.failed")
      result <- createTasks(tracings.map(t => (buildFullParams(params, t), t)))
    } yield {
      result
    }
  }

  private def parseResultToSkeletonTracingFox(parseResult: NmlService.NmlParseResult): Fox[SkeletonTracing] = parseResult match {
    case NmlService.NmlParseFailure(fileName, error) =>
      Fox.failure(Messages("nml.file.invalid", fileName, error))
    case NmlService.NmlParseSuccess(fileName, (Left(skeletonTracing), description)) =>
      Fox.successful(skeletonTracing)
    case _ =>
      Fox.failure(Messages("nml.file.invalid"))
  }

  private def buildFullParams(nmlParams: NmlTaskParameters, tracing: SkeletonTracing) = {
    TaskParameters(
      nmlParams.taskTypeId,
      nmlParams.neededExperience,
      nmlParams.openInstances,
      nmlParams.team,
      nmlParams.projectName,
      nmlParams.scriptId,
      nmlParams.boundingBox,
      tracing.dataSetName,
      tracing.editPosition,
      tracing.editRotation)
  }

  def createTasks(requestedTasks: List[(TaskParameters, SkeletonTracing)])(implicit request: SecuredRequest[_]): Fox[Result] = {
    def assertAllOnSameDataset(): Fox[String] = {
      def allOnSameDatasetIter(requestedTasksRest: List[(TaskParameters, SkeletonTracing)], dataSetName: String): Boolean = {
        requestedTasksRest match {
          case List() => true
          case head :: tail => head._1.dataSet == dataSetName && allOnSameDatasetIter(tail, dataSetName)
        }
      }

      val firstDataSetName = requestedTasks.head._1.dataSet
      if (allOnSameDatasetIter(requestedTasks, requestedTasks.head._1.dataSet))
        Fox.successful(firstDataSetName)
      else
        Fox.failure("Cannot create tasks on multiple datasets in one go.")
    }

    for {
      dataSetName <- assertAllOnSameDataset()
      dataSet <- DataSetDAO.findOneBySourceName(requestedTasks.head._1.dataSet) ?~> Messages("dataSet.notFound", dataSetName)
      tracingReferences: List[Box[TracingReference]] <- dataSet.dataStore.saveSkeletonTracings(SkeletonTracings(requestedTasks.map(_._2)))
      taskObjects: List[Fox[Task]] = requestedTasks.map(r => createTaskWithoutAnnotationBase(r._1))
      zipped = (requestedTasks, tracingReferences, taskObjects).zipped.toList
      annotationBases = zipped.map(tuple => AnnotationService.createAnnotationBase(
        taskFox = tuple._3,
        request.identity._id,
        tracingReferenceBox = tuple._2,
        dataSetName))
      zippedTasksAndAnnotations = taskObjects zip annotationBases
      taskJsons = zippedTasksAndAnnotations.map(tuple => Task.transformToJsonFoxed(tuple._1, tuple._2))
      result <- {
        val taskJsonFuture: Future[List[Box[JsObject]]] = Fox.sequence(taskJsons)
        taskJsonFuture.map { taskJsonBoxes =>
          bulk2StatusJson(taskJsonBoxes)
        }
      }
    } yield Ok(Json.toJson(result))
  }

  private def validateScript(scriptIdOpt: Option[String])(implicit request: SecuredRequest[_]): Fox[Unit] = {
    scriptIdOpt match {
      case Some(scriptId) =>
        for {
          _ <- ScriptDAO.findOneById(scriptId) ?~> Messages("script.notFound")
        } yield ()
      case _ => Fox.successful(())
    }
  }

  private def createTaskWithoutAnnotationBase(params: TaskParameters)(implicit request: SecuredRequest[_]): Fox[Task] = {
    for {
      taskType <- TaskTypeDAO.findOneById(params.taskTypeId) ?~> Messages("taskType.notFound")
      project <- ProjectDAO.findOneByName(params.projectName) ?~> Messages("project.notFound", params.projectName)
      _ <- validateScript(params.scriptId)
      _ <- ensureTeamAdministration(request.identity, params.team)
      task = Task(
        taskType._id,
        params.team,
        params.neededExperience,
        params.openInstances,
        params.openInstances,
        _project = project.name,
        _script = params.scriptId,
        editPosition = params.editPosition,
        editRotation = params.editRotation,
        boundingBox = params.boundingBox.flatMap { box => if (box.isEmpty) None else Some(box) },
        priority = if (project.paused) -1 else project.priority)
      _ <- TaskService.insert(task, project)
    } yield task
  }

  def update(taskId: String) = SecuredAction.async(validateJson[TaskParameters]) { implicit request =>
    val params = request.body
    for {
      task <- TaskService.findOneById(taskId) ?~> Messages("task.notFound")
      _ <- ensureTeamAdministration(request.identity, task._team) ?~> Messages("notAllowed")
      updatedTask <- TaskDAO.updateInstances(task._id, task.instances + params.openInstances - task.openInstances, params.openInstances)
      json <- Task.transformToJson(updatedTask)
    } yield {
      JsonOk(json, Messages("task.editSuccess"))
    }
  }

  def delete(taskId: String) = SecuredAction.async { implicit request =>
    for {
      task <- TaskService.findOneById(taskId) ?~> Messages("task.notFound")
      _ <- ensureTeamAdministration(request.identity, task._team) ?~> Messages("notAllowed")
      _ <- TaskService.remove(task._id)
    } yield {
      JsonOk(Messages("task.removed"))
    }
  }

  def list = SecuredAction.async { implicit request =>
    for {

      tasks <- TaskService.findAllAdministratable(request.identity, limit = 10000)
      js <- Fox.serialCombined(tasks)(t => Task.transformToJson(t))
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def listTasksForType(taskTypeId: String) = SecuredAction.async { implicit request =>
    for {
      tasks <- TaskService.findAllByTaskType(taskTypeId)
      js <- Fox.serialCombined(tasks)(t => Task.transformToJson(t))
    } yield {
      Ok(Json.toJson(js))
    }
  }

  private def parseBsonToFox(s: String): Fox[BSONObjectID] =
    BSONObjectID.parse(s) match {
      case Success(id) => Fox.successful(id)
      case _ => Fox(Future.successful(Empty))
    }

  def listTasks() = SecuredAction.async(parse.json) { implicit request =>

    val userOpt = (request.body \ "user").asOpt[String]
    val projectOpt = (request.body \ "project").asOpt[String]
    val idsOpt = (request.body \ "ids").asOpt[List[String]]
    val taskTypeOpt = (request.body \ "taskType").asOpt[String]

    userOpt match {
      case Some(userId) => {
        for {
          userIdBson <- parseBsonToFox(userId)
          user <- UserDAO.findOneById(userIdBson) ?~> Messages("user.notFound")
          userAnnotations <- AnnotationDAO.findOpenAnnotationsFor(user._id, AnnotationType.Task)
          taskIdsFromAnnotations = userAnnotations.flatMap(_._task).map(_.stringify).toSet
          taskIds = idsOpt match {
            case Some(ids) => taskIdsFromAnnotations.intersect(ids.toSet)
            case None => taskIdsFromAnnotations
          }
          tasks <- TaskDAO.findAllByProjectTaskTypeIds(projectOpt, taskTypeOpt, Some(taskIds.toList))
          jsResult <- Fox.serialCombined(tasks)(t => Task.transformToJson(t))
        } yield {
          Ok(Json.toJson(jsResult))
        }
      }
      case None => {
        for {
          tasks <- TaskDAO.findAllByProjectTaskTypeIds(projectOpt, taskTypeOpt, idsOpt)
          jsResult <- Fox.serialCombined(tasks)(t => Task.transformToJson(t))
        } yield {
          Ok(Json.toJson(jsResult))
        }
      }
    }

  }

  def request = SecuredAction.async { implicit request =>
    val user = request.identity
    for {
      teams <- getAllowedTeamsForNextTask(user)
      _ <- !user.isAnonymous ?~> Messages("user.anonymous.notAllowed")
      task <- tryToGetNextAssignmentFor(user, teams)
      annotation <- AnnotationService.createAnnotationFor(user, task) ?~> Messages("annotation.creationFailed")
      annotationJSON <- annotation.toJson(Some(user))
    } yield {
      JsonOk(annotationJSON, Messages("task.assigned"))
    }
  }


  private def getAllowedTeamsForNextTask(user: User)(implicit ctx: DBAccessContext): Fox[List[BSONObjectID]] = {
    AnnotationService.countOpenNonAdminTasks(user).flatMap { numberOfOpen =>
      if (numberOfOpen < MAX_OPEN_TASKS) {
        Fox.successful(user.teamIds)
      } else if (user.hasAdminAccess) {
        Fox.successful(user.supervisorTeamIds)
      } else {
        Fox.failure(Messages("task.tooManyOpenOnes"))
      }
    }
  }

  private def tryToGetNextAssignmentFor(user: User, teams: List[BSONObjectID], retryCount: Int = 20)(implicit ctx: DBAccessContext): Fox[Task] = {
    val s = System.currentTimeMillis()
    TaskAssignmentService.findOneAssignableFor(user, teams).futureBox.flatMap {
      case Full(task) =>
        NewRelic.recordResponseTimeMetric("Custom/TaskController/findAssignableFor", System.currentTimeMillis - s)
        TimeLogger.logTimeF("task request", logger.trace(_))(TaskAssignmentService.takeInstance(task)).flatMap {
          updateResult =>
            if (updateResult.n >= 1)
              Fox.successful(task)
            else if (retryCount > 0)
              tryToGetNextAssignmentFor(user, teams, retryCount - 1)
            else {
              val e = System.currentTimeMillis()
              logger.warn(s"Failed to remove any assignment for user ${user.email}. " +
                s"Result: $updateResult n:${updateResult.n} ok:${updateResult.ok} " +
                s"code:${updateResult.code} TOOK: ${e - s}ms")
              Fox.failure(Messages("task.unavailable"))
            }
        }.futureBox
      case f: Failure =>
        logger.warn(s"Failure while trying to getNextTask (u: ${user.email} r: $retryCount): " + f)
        if (retryCount > 0)
          tryToGetNextAssignmentFor(user, teams, retryCount - 1).futureBox
        else {
          logger.warn(s"Failed to retrieve any assignment after all retries (u: ${user.email}) due to FAILURE")
          Fox.failure(Messages("assignment.retrieval.failed")).futureBox
        }
      case Empty =>
        logger.warn(s"Failed to retrieve any assignment after all retries (u: ${user.email}) due to EMPTY")
        Fox.failure(Messages("task.unavailable")).futureBox
    }
  }


  def peekNext(limit: Int) = SecuredAction.async { implicit request =>
    val user = request.identity

    for {
      assignments <- TaskAssignmentService.findNAssignableFor(user, user.teamIds, limit)
    } yield {
      Ok(Json.toJson(assignments))
    }
  }

}
