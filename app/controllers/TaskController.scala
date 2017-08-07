package controllers

import java.util.UUID
import javax.inject.Inject

import com.scalableminds.braingames.datastore.tracings.skeleton.CreateEmptyParameters
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits, TimeLogger}
import models.annotation.{AnnotationService, _}
import models.binary.DataSetDAO
import models.project.{Project, ProjectDAO}
import models.task._
import models.user._
import net.liftweb.common.{Box, Empty, Failure, Full}
import oxalis.security.{AuthenticatedRequest, Secured}
import play.api.Play.current
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.iteratee.{Cont, Done, Input, Iteratee}
import play.api.libs.json.Json._
import play.api.libs.json._
import play.api.mvc.{AnyContent, Result}
import play.twirl.api.Html
import reactivemongo.bson.BSONObjectID

import scala.concurrent.Future

class TaskController @Inject() (val messagesApi: MessagesApi) extends Controller with Secured with FoxImplicits {

  val MAX_OPEN_TASKS = current.configuration.getInt("oxalis.tasks.maxOpenPerUser") getOrElse 2

  val baseJsonReads =
    (__ \ 'taskTypeId).read[String] and
      (__ \ 'neededExperience).read[Experience] and
      (__ \ 'status).read[CompletionStatus] and
      (__ \ 'team).read[String] and
      (__ \ 'projectName).read[String] and
      (__ \ 'scriptId).readNullable[String] and
      (__ \ 'boundingBox).readNullable[BoundingBox]

  val taskNMLJsonReads = baseJsonReads.tupled

  val taskCompleteReads =
    (baseJsonReads and
      (__ \ 'dataSet).read[String] and
      (__ \ 'editPosition).read[Point3D] and
      (__ \ 'editRotation).read[Vector3D]).tupled

  def empty = Authenticated { implicit request =>
    Ok(views.html.main()(Html("")))
  }

  def read(taskId: String) = Authenticated.async { implicit request =>
    for {
      task <- TaskService.findOneById(taskId) ?~> Messages("task.notFound")
      js <- Task.transformToJson(task, request.userOpt)
    } yield {
      Ok(js)
    }
  }

  def createFromNML(implicit request: AuthenticatedRequest[AnyContent]) = {
    /*def parseJson(s: String) = {
      Json.parse(s).validate(taskNMLJsonReads) match {
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
        val nmls = NMLService.extractFromFile(nmlFile.ref.file, nmlFile.filename).nmls

        val futureResult: Future[List[Box[JsObject]]] = Fox.serialSequence(nmls){
          case NMLService.NMLParseSuccess(fileName, nml) =>
            val task = Task(
              taskType._id,
              team,
              experience,
              status.open,
              _project = project.name,
              _script = scriptId,
              creationInfo = Some(fileName),
              _id = BSONObjectID.generate)

            for {
              _ <- TaskService.insert(task, project)
              _ <- AnnotationService.createAnnotationBase(task, request.user._id, boundingBox, taskType.settings, nml)
              taskjs <- Task.transformToJson(task, request.userOpt)
            } yield taskjs

          case NMLService.NMLParseFailure(fileName, error) =>
            Fox.failure(Messages("nml.file.invalid", fileName, error))
        }
        futureResult.map { results =>
          val js = bulk2StatusJson(results)
          JsonOk(js, Messages("task.bulk.processed"))
        }
      }
    } yield result*/
    Fox.empty
  }


  def createTaskWithoutAnnotationBase(input: (String, Experience, CompletionStatus, String, String, Option[String], Option[BoundingBox], String, Point3D, Vector3D))(implicit request: AuthenticatedRequest[_]): Fox[Task] =
    input match {
      case (taskTypeId, experience, status, team, projectName, scriptId, boundingBox, dataSetName, start, rotation) =>
        for {
          taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
          project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
          _ <- ensureTeamAdministration(request.user, team)
          task = Task(taskType._id, team, experience, status.open, _project = project.name, _script = scriptId)
          _ <- TaskService.insert(task, project)
        } yield task
    }

  def createSingleTask(input: (String, Experience, CompletionStatus, String, String, Option[String], Option[BoundingBox], String, Point3D, Vector3D))(implicit request: AuthenticatedRequest[_]): Fox[JsObject] =
    input match {
      case (taskTypeId, experience, status, team, projectName, scriptId, boundingBox, dataSetName, start, rotation) =>
        for {
          dataSet <- DataSetDAO.findOneBySourceName(dataSetName).toFox ?~> Messages("dataSet.notFound", dataSetName)
          dataSource <- dataSet.dataSource.toUsable ?~> "DataSet is not imported."
          task <- createTaskWithoutAnnotationBase(input)
          tracingParameters = CreateEmptyParameters(dataSource.id.name, boundingBox, Some(start), Some(rotation), Some(true), Some(true))
          tracingReference <- dataSet.dataStoreInfo.typ.strategy.createEmptySkeletonTracing(dataSet.dataStoreInfo, dataSource, tracingParameters) ?~> "Failed to create skeleton tracing."
          taskType <- task.taskType
          _ <- AnnotationService.createAnnotationBase(task, request.user._id, tracingReference, boundingBox, taskType.settings, dataSetName, start, rotation)
          taskjs <- Task.transformToJson(task, request.userOpt)
        } yield taskjs
    }

  val fox = Fox

  def bulkCreate(json: JsValue)(implicit request: AuthenticatedRequest[_]): Fox[Result] = {
    fox.failure("")
    //TODO: RocksDB
/*
    withJsonUsing(json, Reads.list(taskCompleteReads)) { parsed =>

      {
        for {
          tasks: List[Box[Task]] <- Fox.serialSequence(parsed) { p => createTaskWithoutAnnotationBase(p) }
        } yield {
          val jsResults = tasks.map(task => Task.transformToJson(task, request.userOpt))
          tasks.map { results =>
            val js = bulk2StatusJson(results)
            JsonOk(js, Messages("task.bulk.processed"))
          }
        }


      }
    }*/
  }

  def create(`type`: String = "default") = Authenticated.async { implicit request =>
    `type` match {
      case "default" =>
        request.body.asJson.toFox.flatMap { json =>
          withJsonUsing(json, taskCompleteReads) { parsed =>
            createSingleTask(parsed).futureBox.map{ result =>
              val js = bulk2StatusJson(List(result))
              JsonOk(js, Messages("task.bulk.processed"))
            }
          }
        }
      case "nml"     =>
        createFromNML(request)
      case "bulk"    =>
        request.body.asJson
        .toFox
        .flatMap(json => bulkCreate(json))
    }
  }

  // TODO: properly handle task update with amazon turk
  def update(taskId: String) = Authenticated.async(parse.json) { implicit request =>
    withJsonBodyUsing(taskCompleteReads){
      case (taskTypeId, experience, status, team, projectName, scriptId, boundingBox, dataSetName, start, rotation) =>
        for {
          task <- TaskService.findOneById(taskId) ?~> Messages("task.notFound")
          _ <- ensureTeamAdministration(request.user, task.team) ?~> Messages("notAllowed")
          taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
          project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
          openInstanceCount <- task.remainingInstances
          _ <- (status.open == openInstanceCount || project.assignmentConfiguration.supportsChangeOfNumInstances) ?~> Messages("task.instances.changeImpossible")
          updatedTask <- TaskDAO.update(
            _task = task._id,
            _taskType = taskType._id,
            neededExperience = experience,
            instances = task.instances + status.open - openInstanceCount,
            team = team,
            _script = scriptId,
            _project = Some(project.name),
            boundingBox = boundingBox)
          _ <- AnnotationService.updateAllOfTask(updatedTask, dataSetName, taskType.settings)
          //TODO: rocksdb skeletons api. _ <- AnnotationService.updateAnnotationBase(updatedTask, start, rotation)
          json <- Task.transformToJson(updatedTask, request.userOpt)
          _ <- OpenAssignmentService.updateAllOf(updatedTask, project, status.open)
        } yield {
          JsonOk(json, Messages("task.editSuccess"))
        }
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
      js <- Fox.serialCombined(tasks)(t => Task.transformToJson(t, request.userOpt))
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def listTasksForType(taskTypeId: String) = Authenticated.async { implicit request =>
    for {
      tasks <- TaskService.findAllByTaskType(taskTypeId)
      js <- Fox.serialCombined(tasks)(t => Task.transformToJson(t, request.userOpt))
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
        TimeLogger.logTimeF("task request", logger.trace(_))(OpenAssignmentService.remove(assignment)).flatMap {
          removeResult =>
          if (removeResult.n >= 1)
            Fox.successful(assignment)
          else if (retryCount > 0)
            tryToGetNextAssignmentFor(user, retryCount - 1)
          else {
            val e = System.currentTimeMillis()
            logger.warn(s"Failed to remove any assignment for user ${user.email}. " +
              s"Result: $removeResult n:${removeResult.n} ok:${removeResult.ok} " +
              s"code:${removeResult.code} TOOK: ${e-s}ms")
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
