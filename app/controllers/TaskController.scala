package controllers

import javax.inject.Inject

import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import com.scalableminds.util.mvc.ResultBox
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper, TimeLogger}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonTracings}
import com.scalableminds.webknossos.datastore.tracings.{ProtoGeometryImplicits, TracingReference}
import models.annotation.nml.NmlService
import models.annotation.{AnnotationSQLDAO, AnnotationService, AnnotationTypeSQL}
import models.binary.{DataSetDAO, DataSetSQLDAO}
import models.project.ProjectSQLDAO
import models.task.{ScriptDAO, TaskSQL, TaskSQLDAO, TaskTypeDAO}
import models.team.OrganizationDAO
import models.user._
import net.liftweb.common.Box
import oxalis.security.WebknossosSilhouette.{SecuredAction, SecuredRequest}
import play.api.Play.current
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import play.api.mvc.Result
import utils.ObjectId

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

class TaskController @Inject() (val messagesApi: MessagesApi)
  extends Controller
    with ResultBox
    with ProtoGeometryImplicits
    with FoxImplicits {

  val MAX_OPEN_TASKS = current.configuration.getInt("oxalis.tasks.maxOpenPerUser") getOrElse 2

  def read(taskId: String) = SecuredAction.async { implicit request =>
    for {
      task <- TaskSQLDAO.findOne(ObjectId(taskId)) ?~> Messages("task.notFound")
      js <- task.publicWrites
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
      project <- ProjectSQLDAO.findOneByName(params.projectName) ?~> Messages("project.notFound", params.projectName)
      _ <- ensureTeamAdministration(request.identity, project._team)
      parseResults: List[NmlService.NmlParseResult] = NmlService.extractFromFile(inputFile.ref.file, inputFile.filename).parseResults
      skeletonSuccesses <- Fox.serialCombined(parseResults)(_.toSkeletonSuccessFox) ?~> Messages("task.create.failed")
      result <- createTasks(skeletonSuccesses.map(s => (buildFullParams(params, s.tracing.get.left.get, s.fileName, s.description), s.tracing.get.left.get)))
    } yield {
      result
    }
  }

  private def buildFullParams(nmlParams: NmlTaskParameters, tracing: SkeletonTracing, fileName: String, description: Option[String]) = {
    TaskParameters(
      nmlParams.taskTypeId,
      nmlParams.neededExperience,
      nmlParams.openInstances,
      nmlParams.projectName,
      nmlParams.scriptId,
      nmlParams.boundingBox,
      tracing.dataSetName,
      tracing.editPosition,
      tracing.editRotation,
      Some(fileName),
      description
    )
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

    def taskToJsonFoxed(taskFox: Fox[TaskSQL], otherFox: Fox[_]): Fox[JsObject] = {
      for {
        _ <- otherFox
        task <- taskFox
        js <- task.publicWrites
      } yield js
    }

    for {
      dataSetName <- assertAllOnSameDataset()
      dataSet <- DataSetDAO.findOneBySourceName(requestedTasks.head._1.dataSet) ?~> Messages("dataSet.notFound", dataSetName)
      dataSetId <- DataSetSQLDAO.getIdByName(requestedTasks.head._1.dataSet)
      tracingReferences: List[Box[TracingReference]] <- dataSet.dataStore.saveSkeletonTracings(SkeletonTracings(requestedTasks.map(_._2)))
      requestedTasksWithTracingReferences = requestedTasks zip tracingReferences
      taskObjects: List[Fox[TaskSQL]] = requestedTasksWithTracingReferences.map(r => createTaskWithoutAnnotationBase(r._1._1, r._2))
      zipped = (requestedTasks, tracingReferences, taskObjects).zipped.toList
      annotationBases = zipped.map(tuple => AnnotationService.createAnnotationBase(
        taskFox = tuple._3,
        request.identity._id,
        tracingReferenceBox = tuple._2,
        dataSetId,
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

  private def validateScript(scriptIdOpt: Option[String])(implicit request: SecuredRequest[_]): Fox[Unit] = {
    scriptIdOpt match {
      case Some(scriptId) =>
        for {
          _ <- ScriptDAO.findOneById(scriptId) ?~> Messages("script.notFound")
        } yield ()
      case _ => Fox.successful(())
    }
  }

  private def createTaskWithoutAnnotationBase(params: TaskParameters, tracingReferenceBox: Box[TracingReference])(implicit request: SecuredRequest[_]): Fox[TaskSQL] = {
    for {
      _ <- tracingReferenceBox.toFox
      taskType <- TaskTypeDAO.findOneById(params.taskTypeId) ?~> Messages("taskType.notFound")
      project <- ProjectSQLDAO.findOneByName(params.projectName) ?~> Messages("project.notFound", params.projectName)
      _ <- validateScript(params.scriptId)
      _ <- ensureTeamAdministration(request.identity, project._team)
      task = TaskSQL(
        ObjectId.generate,
        project._id,
        params.scriptId.map(ObjectId(_)),
        ObjectId.fromBsonId(taskType._id),
        params.neededExperience,
        params.openInstances, //all instances are open at this time
        params.openInstances,
        tracingTime = None,
        boundingBox = params.boundingBox.flatMap { box => if (box.isEmpty) None else Some(box) },
        editPosition = params.editPosition,
        editRotation = params.editRotation,
        creationInfo = params.creationInfo
      )
      _ <- TaskSQLDAO.insertOne(task)
    } yield task
  }


  def update(taskId: String) = SecuredAction.async(validateJson[TaskParameters]) { implicit request =>
    val params = request.body
    for {
      taskIdValidated <- ObjectId.parse(taskId)
      task <- TaskSQLDAO.findOne(taskIdValidated) ?~> Messages("task.notFound")
      project <- task.project
      _ <- ensureTeamAdministration(request.identity, project._team) ?~> Messages("notAllowed")
      _ <- TaskSQLDAO.updateTotalInstances(task._id, task.totalInstances + params.openInstances - task.openInstances)
      updatedTask <- TaskSQLDAO.findOne(taskIdValidated)
      json <- updatedTask.publicWrites
    } yield {
      JsonOk(json, Messages("task.editSuccess"))
    }
  }

  def delete(taskId: String) = SecuredAction.async { implicit request =>
    for {
      taskIdValidated <- ObjectId.parse(taskId)
      task <- TaskSQLDAO.findOne(taskIdValidated) ?~> Messages("task.notFound")
      project <- task.project
      _ <- ensureTeamAdministration(request.identity, project._team) ?~> Messages("notAllowed")
      _ <- TaskSQLDAO.deleteOne(task._id)
    } yield {
      JsonOk(Messages("task.removed"))
    }
  }

  def listTasksForType(taskTypeId: String) = SecuredAction.async { implicit request =>
    for {
      taskTypeIdValidated <- ObjectId.parse(taskTypeId)
      tasks <- TaskSQLDAO.findAllByTaskType(taskTypeIdValidated)
      js <- Fox.serialCombined(tasks)(_.publicWrites)
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def listTasks = SecuredAction.async(parse.json) { implicit request =>

    for {
      userIdOpt <- Fox.runOptional((request.body \ "user").asOpt[String])(ObjectId.parse(_))
      projectNameOpt = (request.body \ "project").asOpt[String]
      taskIdsOpt <- Fox.runOptional((request.body \ "ids").asOpt[List[String]])(ids => Fox.serialCombined(ids)(ObjectId.parse))
      taskTypeIdOpt <- Fox.runOptional((request.body \ "taskType").asOpt[String])(ObjectId.parse(_))
      tasks <- TaskSQLDAO.findAllByProjectAndTaskTypeAndIdsAndUser(projectNameOpt, taskTypeIdOpt, taskIdsOpt, userIdOpt)
      jsResult <- Fox.serialCombined(tasks)(_.publicWrites)
    } yield {
      Ok(Json.toJson(jsResult))
    }

  }

  def request = SecuredAction.async { implicit request =>
    val user = request.identity
    for {
      teams <- getAllowedTeamsForNextTask(user)
      _ <- !user.isAnonymous ?~> Messages("user.anonymous.notAllowed")
      (task, initializingAnnotationId) <-  TaskSQLDAO.assignNext(ObjectId.fromBsonId(user._id), teams) ?~> Messages("task.unavailable")
      insertedAnnotationBox <- AnnotationService.createAnnotationFor(user, task, initializingAnnotationId).futureBox
      _ <- AnnotationService.abortInitializedAnnotationOnFailure(initializingAnnotationId, insertedAnnotationBox)
      annotation <- insertedAnnotationBox.toFox
      annotationJSON <- annotation.publicWrites(Some(user))
    } yield {
      JsonOk(annotationJSON, Messages("task.assigned"))
    }
  }


  private def getAllowedTeamsForNextTask(user: User)(implicit ctx: DBAccessContext): Fox[List[ObjectId]] = {
    AnnotationService.countOpenNonAdminTasks(user).flatMap { numberOfOpen =>
      if (user.isAdmin) {
        OrganizationDAO.findOneByName(user.organization).map(_.teams.map(ObjectId.fromBsonId))
      } else if (numberOfOpen < MAX_OPEN_TASKS) {
        Fox.successful(user.teamIds.map(ObjectId.fromBsonId))
      } else if (user.teamManagerTeamIds.nonEmpty) {
        Fox.successful(user.teamManagerTeamIds.map(ObjectId.fromBsonId))
      } else {
        Fox.failure(Messages("task.tooManyOpenOnes"))
      }
    }
  }

  def peekNext = SecuredAction.async { implicit request =>
    val user = request.identity
    for {
      task <- TaskSQLDAO.peekNextAssignment(ObjectId.fromBsonId(user._id), user.teamIds.map(ObjectId.fromBsonId)) ?~> Messages("task.unavailable")
      taskJson <- task.publicWrites(GlobalAccessContext)
    } yield Ok(taskJson)
  }

}
