package controllers

import java.util.UUID
import javax.inject.Inject

import com.newrelic.api.agent.NewRelic
import com.scalableminds.braingames.datastore.SkeletonTracing.{SkeletonTracing, SkeletonTracings}
import com.scalableminds.braingames.datastore.tracings.{ProtoGeometryImplicits, TracingReference}
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper, TimeLogger}
import models.annotation.{AnnotationDAO, AnnotationService, AnnotationType}
import models.annotation.nml.NmlService
import models.binary.DataSetDAO
import models.project.{Project, ProjectDAO}
import models.task._
import models.user._
import net.liftweb.common.{Box, Empty, Failure, Full}
import oxalis.security.{AuthenticatedRequest, Secured}
import play.api.Play.current
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.iteratee._
import play.api.libs.json.Json._
import play.api.libs.json._
import play.api.mvc.Result
import play.twirl.api.Html
import reactivemongo.bson.BSONObjectID

import scala.concurrent.Future
import scala.util.Success

case class TaskParameters(
                           taskTypeId: String,
                           neededExperience: Experience,
                           status: CompletionStatus,
                           team: String,
                           projectName: String,
                           scriptId: Option[String],
                           boundingBox: Option[BoundingBox],
                           dataSet: String,
                           editPosition: Point3D,
                           editRotation: Vector3D)

object TaskParameters {
  implicit val taskParametersFormat = Json.format[TaskParameters]
}

case class NmlTaskParameters(
                              taskTypeId: String,
                              neededExperience: Experience,
                              status: CompletionStatus,
                              team: String,
                              projectName: String,
                              scriptId: Option[String],
                              boundingBox: Option[BoundingBox])

object NmlTaskParameters {
  implicit val nmlTaskParametersFormat = Json.format[NmlTaskParameters]
}

class TaskController @Inject() (val messagesApi: MessagesApi) extends Controller with ProtoGeometryImplicits with Secured with FoxImplicits {

  val MAX_OPEN_TASKS = current.configuration.getInt("oxalis.tasks.maxOpenPerUser") getOrElse 2

  def empty = Authenticated { implicit request =>
    Ok(views.html.main()(Html("")))
  }

  def read(taskId: String) = Authenticated.async { implicit request =>
    for {
      task <- TaskService.findOneById(taskId) ?~> Messages("task.notFound")
      js <- Task.transformToJson(task)
    } yield {
      Ok(js)
    }
  }

  def create = Authenticated.async(validateJson[List[TaskParameters]]) { implicit request =>
    createTasks(request.body.map { params =>
      val tracing = AnnotationService.createTracingBase(params.dataSet, params.boundingBox, params.editPosition, params.editRotation)
      (params, tracing)
    })
  }

  def createFromFile = Authenticated.async { implicit request =>

    for {
      body <- request.body.asMultipartFormData ?~> Messages("invalid")
      inputFile <- body.file("nmlFile") ?~> Messages("nml.file.notFound")
      jsonString <- body.dataParts.get("formJSON").flatMap(_.headOption) ?~> Messages("format.json.missing")
      params <- JsonHelper.parseJsonToFox[NmlTaskParameters](jsonString) ?~> Messages("task.create.failed")
      taskType <- TaskTypeDAO.findOneById(params.taskTypeId) ?~> Messages("taskType.notFound")
      project <- ProjectDAO.findOneByName(params.projectName) ?~> Messages("project.notFound", params.projectName)
      _ <- ensureTeamAdministration(request.user, params.team)

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
    case NmlService.NmlParseSuccess(fileName, tracing) =>
      Fox.successful(tracing.asInstanceOf[SkeletonTracing])
  }

  private def buildFullParams(nmlParams: NmlTaskParameters, tracing: SkeletonTracing) = {
    TaskParameters(
      nmlParams.taskTypeId,
      nmlParams.neededExperience,
      nmlParams.status,
      nmlParams.team,
      nmlParams.projectName,
      nmlParams.scriptId,
      nmlParams.boundingBox,
      tracing.dataSetName,
      tracing.editPosition,
      tracing.editRotation)
  }

  def createTasks(requestedTasks: List[(TaskParameters, SkeletonTracing)])(implicit request: AuthenticatedRequest[_]): Fox[Result] = {
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
      dataSet <- DataSetDAO.findOneBySourceName(requestedTasks.head._1.dataSet) ?~> Messages("dataset.notFound")
      tracingReferences: List[Box[TracingReference]] <- dataSet.dataStore.saveSkeletonTracings(SkeletonTracings(requestedTasks.map(_._2)))
      taskObjects: List[Fox[Task]] = requestedTasks.map(r => createTaskWithoutAnnotationBase(r._1))
      zipped = (requestedTasks, tracingReferences, taskObjects).zipped.toList
      annotationBases = zipped.map(tuple => AnnotationService.createAnnotationBase(
                                                                taskFox = tuple._3,
                                                                request.user._id,
                                                                tracingReferenceBox=tuple._2,
                                                                dataSetName))
      zippedTasksAndAnnotations = taskObjects zip annotationBases
      taskJsons = zippedTasksAndAnnotations.map(tuple => Task.transformToJsonFoxed(tuple._1, tuple._2))
      result <- {
        val taskJsonFuture: Future[List[Box[JsObject]]] = Fox.sequence(taskJsons)
        taskJsonFuture.map {taskJsonBoxes =>
          val js = bulk2StatusJson(taskJsonBoxes)
          JsonOk(js, Messages("task.bulk.processed"))
        }
      }
    } yield result
  }



  private def createTaskWithoutAnnotationBase(params: TaskParameters)(implicit request: AuthenticatedRequest[_]): Fox[Task] = {
    for {
      taskType <- TaskTypeDAO.findOneById(params.taskTypeId) ?~> Messages("taskType.notFound")
      project <- ProjectDAO.findOneByName(params.projectName) ?~> Messages("project.notFound", params.projectName)
      _ <- ensureTeamAdministration(request.user, params.team)
      task = Task(
        taskType._id,
        params.team,
        params.neededExperience,
        params.status.open,
        _project = project.name,
        _script = params.scriptId,
        editPosition = params.editPosition,
        editRotation = params.editRotation,
        boundingBox = params.boundingBox)
      _ <- TaskService.insert(task, project)
    } yield task
  }


  // TODO: properly handle task update with amazon turk
  def update(taskId: String) = Authenticated.async(validateJson[TaskParameters]) { implicit request =>
    val params = request.body
    for {
      task <- TaskService.findOneById(taskId) ?~> Messages("task.notFound")
      _ <- ensureTeamAdministration(request.user, task.team) ?~> Messages("notAllowed")
      taskType <- TaskTypeDAO.findOneById(params.taskTypeId) ?~> Messages("taskType.notFound")
      project <- ProjectDAO.findOneByName(params.projectName) ?~> Messages("project.notFound", params.projectName)
      openInstanceCount <- task.remainingInstances
      _ <- (params.status.open == openInstanceCount || project.assignmentConfiguration.supportsChangeOfNumInstances) ?~> Messages("task.instances.changeImpossible")
      updatedTask <- TaskDAO.update(
        _task = task._id,
        _taskType = taskType._id,
        neededExperience = params.neededExperience,
        instances = task.instances + params.status.open - openInstanceCount,
        team = params.team,
        _script = params.scriptId,
        _project = Some(project.name),
        boundingBox = params.boundingBox,
        editPosition = params.editPosition,
        editRotation = params.editRotation)
      _ <- AnnotationService.updateAllOfTask(updatedTask, taskType.settings)

      newTracingBase = AnnotationService.createTracingBase(params.dataSet, params.boundingBox, params.editPosition,  params.editRotation)
      dataSet <- DataSetDAO.findOneBySourceName(params.dataSet).toFox ?~> Messages("dataSet.notFound", params.dataSet)
      newTracingBaseReference <- dataSet.dataStore.saveSkeletonTracing(newTracingBase) ?~> "Failed to save skeleton tracing."
       _ <- AnnotationService.updateAnnotationBase(updatedTask, newTracingBaseReference)
      json <- Task.transformToJson(updatedTask)
      _ <- OpenAssignmentService.updateRemainingInstances(updatedTask, project, params.status.open)
    } yield {
      JsonOk(json, Messages("task.editSuccess"))
    }
  }

  def delete(taskId: String) = Authenticated.async { implicit request =>
    for {
      task <- TaskService.findOneById(taskId) ?~> Messages("task.notFound")
      _ <- ensureTeamAdministration(request.user, task.team) ?~> Messages("notAllowed")
      _ <- TaskService.remove(task._id)
    } yield {
      JsonOk(Messages("task.removed"))
    }
  }

  def list = Authenticated.async{ implicit request =>
    for {
      tasks <- TaskService.findAllAdministratable(request.user, limit = 10000)
      js <- Fox.serialCombined(tasks)(t => Task.transformToJson(t))
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def listTasksForType(taskTypeId: String) = Authenticated.async { implicit request =>
    for {
      tasks <- TaskService.findAllByTaskType(taskTypeId)
      js <- Fox.serialCombined(tasks)(t => Task.transformToJson(t))
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def parseBsonToFox(s: String): Fox[BSONObjectID] =
    BSONObjectID.parse(s) match {
      case Success(id) => Fox.successful(id)
      case _ => Fox(Future.successful(Empty))
    }

  def listTasks() = Authenticated.async(parse.json) { implicit request =>

    val userOpt = (request.body \ "user").asOpt[String]
    val projectOpt =  (request.body \ "project").asOpt[String]
    val idsOpt = (request.body \ "ids").asOpt[List[String]]
    val taskTypeOpt =  (request.body \ "taskType").asOpt[String]

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

  def getAllowedTeamsForNextTask(user: User)(implicit ctx: DBAccessContext): Fox[List[String]] = {
    AnnotationService.countOpenNonAdminTasks(user).flatMap { numberOfOpen =>
      if (numberOfOpen < MAX_OPEN_TASKS) {
        Fox.successful(user.teamNames)
      } else if (user.hasAdminAccess) {
        Fox.successful(user.adminTeamNames)
      } else {
        Fox.failure(Messages("task.tooManyOpenOnes"))
      }
    }
  }

  def getProjectsFor(tasks: List[Task])(implicit ctx: DBAccessContext): Future[List[Project]] =
    Fox.serialSequence(tasks)(_.project).map(_.flatten).map(_.distinct)

  def createAvailableTasksJson(availableTasksMap: Map[User, (Int, List[Project])]) =
    Json.toJson(availableTasksMap.map { case (user, (taskCount, projects)) =>
      Json.obj(
        "name" -> user.name,
        "teams" -> user.teamNames,
        "availableTaskCount" -> taskCount,
        "projects" -> projects.map(_.name)
      )
    })

  def requestAvailableTasks = Authenticated.async { implicit request =>
    // TODO: WORKLOAD CURRENTLY DISABLED DUE TO PERFORMANCE REASONS
    Future.successful(Ok(Json.arr()))
//    for {
//      availableTasksMap <- getAllAvailableTaskCountsAndProjects()
//    } yield {
//      Ok(createAvailableTasksJson(availableTasksMap))
//    }
  }

  def tryToGetNextAssignmentFor(user: User, teams: List[String], retryCount: Int = 20)(implicit ctx: DBAccessContext): Fox[OpenAssignment] = {
    val s = System.currentTimeMillis()
    TaskService.findAssignableFor(user, teams).futureBox.flatMap {
      case Full(assignment) =>
        NewRelic.recordResponseTimeMetric("Custom/TaskController/findAssignableFor", System.currentTimeMillis - s)
        TimeLogger.logTimeF("task request", logger.trace(_))(OpenAssignmentService.take(assignment)).flatMap {
          updateResult =>
          if (updateResult.n >= 1)
            Fox.successful(assignment)
          else if (retryCount > 0)
            tryToGetNextAssignmentFor(user, teams, retryCount - 1)
          else {
            val e = System.currentTimeMillis()
            logger.warn(s"Failed to remove any assignment for user ${user.email}. " +
              s"Result: $updateResult n:${updateResult.n} ok:${updateResult.ok} " +
              s"code:${updateResult.code} TOOK: ${e-s}ms")
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

  def request = Authenticated.async { implicit request =>
    val user = request.user
    val id = UUID.randomUUID().toString
    for {
      teams <- getAllowedTeamsForNextTask(user)
      _ <- !user.isAnonymous ?~> Messages("user.anonymous.notAllowed")
      assignment <- tryToGetNextAssignmentFor(user, teams)
      task <- assignment.task
      annotation <- AnnotationService.createAnnotationFor(user, task) ?~> Messages("annotation.creationFailed")
      annotationJSON <- annotation.toJson(Some(user))
    } yield {
      JsonOk(annotationJSON, Messages("task.assigned"))
    }
  }

  def peekNext(limit: Int) = Authenticated.async { implicit request =>
    val user = request.user

    def takeUpTo[E](n: Int, filter: (Seq[E], E) => Boolean): Iteratee[E, Seq[E]] = {
      def stepWith(accum: Seq[E]): Iteratee[E, Seq[E]] = {
        if (accum.length >= n) Done(accum) else Cont {
          case Input.EOF =>
            Done(accum, Input.EOF)
          case Input.Empty =>
            stepWith(accum)
          case Input.El(el) =>
            if(filter(accum, el))
              stepWith(accum :+ el)
            else
              stepWith(accum)
        }
      }
      stepWith(Seq.empty)
    }

    def uniqueIdFilter(l: Seq[OpenAssignment], next: OpenAssignment) =
      !l.map(_._task).contains(next._task)

    def findNextAssignments = {
      TaskService.findAssignable(user, user.teamNames) |>>> takeUpTo[OpenAssignment](limit, uniqueIdFilter)
    }

    for {
      assignments <- findNextAssignments
    } yield {
      Ok(Json.toJson(assignments))
    }
  }
}
