package controllers

import java.util.UUID
import javax.inject.Inject

import com.newrelic.api.agent.NewRelic
import com.scalableminds.braingames.datastore.tracings.skeleton.elements.SkeletonTracing
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits, TimeLogger}
import models.annotation.AnnotationService
import models.binary.DataSetDAO
import models.project.{Project, ProjectDAO}
import models.task._
import models.user._
import net.liftweb.common.{Box, Empty, Failure, Full}
import oxalis.security.{AuthenticatedRequest, Secured}
import play.api.Play.current
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.iteratee.{Cont, Done, Input, Iteratee}
import play.api.libs.json.Json._
import play.api.libs.json._
import play.twirl.api.Html

import scala.concurrent.Future

case class TaskParameters(
                           taskTypeId: String,
                           neededExperience: Experience,
                           status: CompletionStatus,
                           team: String,
                           projectName: String,
                           scriptId: Option[String],
                           boundingBox: Option[BoundingBox],
                           dataSetName: String,
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

class TaskController @Inject() (val messagesApi: MessagesApi) extends Controller with Secured with FoxImplicits {

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
      val tracing = AnnotationService.createTracingBase(params.dataSetName, params.boundingBox, params.editPosition, params.editRotation)
      (params, tracing)
    }).map(JsonOk(_, Messages("task.bulk.processed")))
  }

  def createFromFile = Authenticated.async { implicit request =>
    Future.successful(Ok)
  }

  def createTasks(requestedTasks: List[(TaskParameters, SkeletonTracing)]): Future[JsObject] = {

    def processGrouped[X, Y, K](items: List[X])(group: X => K)(process: (K, List[X]) => List[Y]): List[Y] = {
      val itemGroups = items
        .zipWithIndex
        .groupBy(item => group(item._1))

      val results = itemGroups.map { itemGroup =>
        val key = itemGroup._1
        val values = itemGroup._2.map(_._1)
        val indices = itemGroup._2.map(_._2)
        process(key, values).zip(indices)
      }.toList.flatten

      results.sortBy(_._2).map(_._1)
    }

    processGrouped(requestedTasks)(_._1.dataSetName){ (dataSetName, requestedTasks) =>
      DataSetDAO.findOneBySourceName(dataSetName).futureBox.map {
        case Full(dataSet) =>
          dataSet.dataStore.saveSkeletonTracings(requestedTasks.map(_._2))
        case _ =>
          Fox.failure("geht nicht")
      }
    }
  }


/*  private def createFromNml(implicit request: AuthenticatedRequest[AnyContent]) = {
    def parseJson(s: String) = {
      Json.parse(s).validate(taskNmlJsonReads) match {
        case JsSuccess(parsed, _) =>
          Full(parsed)
        case errors: JsError =>
          Failure(Messages("task.create.failed"))
      }
    }

    for {
      body <- request.body.asMultipartFormData ?~> Messages("invalid")
      nmlFile <- body.file("nmlFile") ?~> Messages("nml.file.notFound")
      stringifiedJson <- body.dataParts.get("formJSON").flatMap(_.headOption) ?~> Messages("format.json.missing")
      (taskTypeId, experience, status, team, projectName, scriptId, boundingBox) <- parseJson(stringifiedJson).toFox
      taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
      project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
      _ <- ensureTeamAdministration(request.user, team)
      result <- {
        val parseResults = NmlService.extractFromFile(nmlFile.ref.file, nmlFile.filename).parseResults

        val futureResult: Future[List[Box[JsObject]]] = Fox.serialSequence(parseResults){
          case NmlService.NmlParseSuccess(fileName, tracing) =>
            val task = Task(taskType._id, team, experience, status.open, _project = project.name,
                            _script = scriptId, editPosition=tracing.editPosition,
                            editRotation=tracing.editRotation, boundingBox=boundingBox)
            val skeletonTracing = tracing.asInstanceOf[SkeletonTracing]
            for {
              dataSet <- DataSetDAO.findOneBySourceName(tracing.dataSetName).toFox ?~> Messages("datSet.notFound")
              tracingReference <- dataSet.dataStore.saveSkeletonTracing(skeletonTracing) ?~> Messages("tracing.couldNotSave")
              _ <- TaskService.insert(task, project) ?~> Messages("could not save task")
              _ <- AnnotationService.createAnnotationBase(task, request.user._id, tracingReference, taskType.settings, tracing.dataSetName) ?~> Messages("failed to create annotation base")
              taskjs <- Task.transformToJson(task) ?~> Messages("failed to transform task to json")
            } yield taskjs

          case NmlService.NmlParseFailure(fileName, error) =>
            Fox.failure(Messages("nml.file.invalid", fileName, error))
        }
        futureResult.map { results =>
          val js = bulk2StatusJson(results)
          JsonOk(js, Messages("task.bulk.processed"))
        }
      }
    } yield result
  }

*/

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

  private def createSingleTask(params: TaskParameters)(implicit request: AuthenticatedRequest[_]): Fox[JsObject] = {
    for {
      dataSet <- DataSetDAO.findOneBySourceName(params.dataSetName).toFox ?~> Messages ("dataSet.notFound", params.dataSetName)
      task <- createTaskWithoutAnnotationBase(params)
      tracing = AnnotationService.createTracingBase(params.dataSetName, params.boundingBox, params.editPosition, params.editRotation)
      tracingReference <- dataSet.dataStore.saveSkeletonTracing(tracing) ?~> "Failed to save tracing base."
      taskType <- task.taskType
      _ <- AnnotationService.createAnnotationBase(task, request.user._id, tracingReference, taskType.settings, params.dataSetName)
      taskjs <- Task.transformToJson(task)
    } yield taskjs
  }

  //TODO: RocksDB
  /*private def bulkCreate(json: JsValue)(implicit request: AuthenticatedRequest[_]): Fox[Result] = {

    withJsonUsing(json, Reads.list(taskCompleteReads)) { parsed =>

      {
        for {
          tasks: List[Box[Task]] <- Fox.serialSequence(parsed) { p => createTaskWithoutAnnotationBase(p) }
        } yield {
          JsonOk("not implemented")
          /*val jsResults = tasks.map(task => Task.transformToJson(task, request.userOpt))
          tasks.map { results =>
            val js = bulk2StatusJson(results)
            JsonOk(js, Messages("task.bulk.processed"))
          }*/
        }


      }
    }
  }*/


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

      newTracingBase = AnnotationService.createTracingBase(params.dataSetName, params.boundingBox, params.editPosition,  params.editRotation)
      dataSet <- DataSetDAO.findOneBySourceName(params.dataSetName).toFox ?~> Messages("dataSet.notFound", params.dataSetName)
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

  def ensureMaxNumberOfOpenTasks(user: User)(implicit ctx: DBAccessContext): Fox[Int] = {
    AnnotationService.countOpenTasks(user).flatMap{ numberOfOpen =>
      if (numberOfOpen < MAX_OPEN_TASKS)
        Fox.successful(numberOfOpen)
      else
        Fox.failure(Messages("task.tooManyOpenOnes"))
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

  def tryToGetNextAssignmentFor(user: User, retryCount: Int = 20)(implicit ctx: DBAccessContext): Fox[OpenAssignment] = {
    val s = System.currentTimeMillis()
    TaskService.findAssignableFor(user).futureBox.flatMap {
      case Full(assignment) =>
        NewRelic.recordResponseTimeMetric("Custom/TaskController/findAssignableFor", System.currentTimeMillis - s)
        TimeLogger.logTimeF("task request", logger.trace(_))(OpenAssignmentService.take(assignment)).flatMap {
          updateResult =>
          if (updateResult.n >= 1)
            Fox.successful(assignment)
          else if (retryCount > 0)
            tryToGetNextAssignmentFor(user, retryCount - 1)
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
          tryToGetNextAssignmentFor(user, retryCount - 1).futureBox
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
      _ <- ensureMaxNumberOfOpenTasks(user)
      _ <- !user.isAnonymous ?~> Messages("user.anonymous.notAllowed")
      assignment <- tryToGetNextAssignmentFor(user)
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
      TaskService.findAssignable(user) |>>> takeUpTo[OpenAssignment](limit, uniqueIdFilter)
    }
    for {
      assignments <- findNextAssignments
    } yield {
      Ok(Json.toJson(assignments))
    }
  }
}
