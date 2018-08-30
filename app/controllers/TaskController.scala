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
import models.binary.DataSetDAO
import models.project.ProjectDAO
import models.task._
import models.team.OrganizationService
import models.user._
import net.liftweb.common.Box
import oxalis.security.WebknossosSilhouette.{SecuredAction, SecuredRequest}
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

class TaskController @Inject() (organizationService: OrganizationService,
                                annotationService: AnnotationService,
                                scriptDAO: ScriptDAO,
                                projectDAO: ProjectDAO,
                                val messagesApi: MessagesApi)
  extends Controller
    with ResultBox
    with ProtoGeometryImplicits
    with FoxImplicits {

  val MAX_OPEN_TASKS = WkConf.Oxalis.Tasks.maxOpenPerUser

  def read(taskId: String) = SecuredAction.async { implicit request =>
    for {
      task <- TaskDAO.findOne(ObjectId(taskId)) ?~> Messages("task.notFound")
      js <- task.publicWrites
    } yield {
      Ok(js)
    }
  }


  def create = SecuredAction.async(validateJson[List[TaskParameters]]) { implicit request =>
    createTasks(request.body.map { params =>
      val tracing = annotationService.createTracingBase(params.dataSet, params.boundingBox, params.editPosition, params.editRotation)
      (params, tracing)
    })
  }

  def createFromFile = SecuredAction.async { implicit request =>
    for {
      body <- request.body.asMultipartFormData ?~> Messages("invalid")
      inputFile <- body.file("nmlFile[]") ?~> Messages("nml.file.notFound")
      jsonString <- body.dataParts.get("formJSON").flatMap(_.headOption) ?~> Messages("format.json.missing")
      params <- JsonHelper.parseJsonToFox[NmlTaskParameters](jsonString) ?~> Messages("task.create.failed")
      taskTypeIdValidated <- ObjectId.parse(params.taskTypeId)
      taskType <- TaskTypeDAO.findOne(taskTypeIdValidated) ?~> Messages("taskType.notFound")
      project <- ProjectDAO.findOneByName(params.projectName) ?~> Messages("project.notFound", params.projectName)
      _ <- ensureTeamAdministration(request.identity, project._team)
      parseResults: List[NmlService.NmlParseResult] = NmlService.extractFromFile(inputFile.ref.file, inputFile.filename).parseResults
      skeletonSuccesses <- Fox.serialCombined(parseResults)(_.toSkeletonSuccessFox) ?~> Messages("task.create.failed")
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

  def createTasks(requestedTasks: List[(TaskParameters, SkeletonTracing)])(implicit request: SecuredRequest[_]): Fox[Result] = {
    def assertAllOnSameDataset: Fox[String] = {
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

    def taskToJsonFoxed(taskFox: Fox[Task], otherFox: Fox[_]): Fox[JsObject] = {
      for {
        _ <- otherFox
        task <- taskFox
        js <- task.publicWrites
      } yield js
    }

    for {
      dataSetName <- assertAllOnSameDataset
      dataSet <- DataSetDAO.findOneByName(requestedTasks.head._1.dataSet) ?~> Messages("dataSet.notFound", dataSetName)
      dataStoreHandler <- dataSet.dataStoreHandler
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

  private def validateScript(scriptIdOpt: Option[String])(implicit request: SecuredRequest[_]): Fox[Unit] = {
    scriptIdOpt match {
      case Some(scriptId) =>
        for {
          scriptIdValidated <- ObjectId.parse(scriptId)
          _ <- scriptDAO.findOne(scriptIdValidated) ?~> Messages("script.notFound")
        } yield ()
      case _ => Fox.successful(())
    }
  }

  private def createTaskWithoutAnnotationBase(params: TaskParameters, skeletonTracingIdBox: Box[String])(implicit request: SecuredRequest[_]): Fox[Task] = {
    for {
      _ <- skeletonTracingIdBox.toFox
      taskTypeIdValidated <- ObjectId.parse(params.taskTypeId)
      taskType <- TaskTypeDAO.findOne(taskTypeIdValidated) ?~> Messages("taskType.notFound")
      project <- projectDAO.findOneByName(params.projectName) ?~> Messages("project.notFound", params.projectName)
      _ <- validateScript(params.scriptId)
      _ <- ensureTeamAdministration(request.identity, project._team)
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
      _ <- TaskDAO.insertOne(task)
    } yield task
  }


  def update(taskId: String) = SecuredAction.async(validateJson[TaskParameters]) { implicit request =>
    val params = request.body
    for {
      taskIdValidated <- ObjectId.parse(taskId)
      task <- TaskDAO.findOne(taskIdValidated) ?~> Messages("task.notFound")
      project <- task.project
      _ <- ensureTeamAdministration(request.identity, project._team) ?~> Messages("notAllowed")
      _ <- TaskDAO.updateTotalInstances(task._id, task.totalInstances + params.openInstances - task.openInstances)
      updatedTask <- TaskDAO.findOne(taskIdValidated)
      json <- updatedTask.publicWrites
    } yield {
      JsonOk(json, Messages("task.editSuccess"))
    }
  }

  def delete(taskId: String) = SecuredAction.async { implicit request =>
    for {
      taskIdValidated <- ObjectId.parse(taskId)
      task <- TaskDAO.findOne(taskIdValidated) ?~> Messages("task.notFound")
      project <- task.project
      _ <- ensureTeamAdministration(request.identity, project._team) ?~> Messages("notAllowed")
      _ <- TaskDAO.removeOneAndItsAnnotations(task._id)
    } yield {
      JsonOk(Messages("task.removed"))
    }
  }

  def listTasksForType(taskTypeId: String) = SecuredAction.async { implicit request =>
    for {
      taskTypeIdValidated <- ObjectId.parse(taskTypeId)
      tasks <- TaskDAO.findAllByTaskType(taskTypeIdValidated)
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
      randomizeOpt = (request.body \ "random").asOpt[Boolean]
      tasks <- TaskDAO.findAllByProjectAndTaskTypeAndIdsAndUser(projectNameOpt, taskTypeIdOpt, taskIdsOpt, userIdOpt, randomizeOpt)
      jsResult <- Fox.serialCombined(tasks)(_.publicWrites)
    } yield {
      Ok(Json.toJson(jsResult))
    }
  }

  def request = SecuredAction.async { implicit request =>
    val user = request.identity
    for {
      teams <- getAllowedTeamsForNextTask(user)
      (task, initializingAnnotationId) <-  TaskDAO.assignNext(user._id, teams) ?~> Messages("task.unavailable")
      insertedAnnotationBox <- annotationService.createAnnotationFor(user, task, initializingAnnotationId).futureBox
      _ <- annotationService.abortInitializedAnnotationOnFailure(initializingAnnotationId, insertedAnnotationBox)
      annotation <- insertedAnnotationBox.toFox
      annotationJSON <- annotation.publicWrites(Some(user))
    } yield {
      JsonOk(annotationJSON, Messages("task.assigned"))
    }
  }


  private def getAllowedTeamsForNextTask(user: User)(implicit ctx: DBAccessContext): Fox[List[ObjectId]] = {
    (for {
      numberOfOpen <- annotationService.countOpenNonAdminTasks(user)
    } yield {
      if (user.isAdmin) {
        organizationService.findTeamIdsOf(user._organization)
      } else if (numberOfOpen < MAX_OPEN_TASKS) {
        user.teamIds
      } else {
        (for {
          teamManagerTeamIds <- user.teamManagerTeamIds
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

  def peekNext = SecuredAction.async { implicit request =>
    val user = request.identity
    for {
      teamIds <- user.teamIds
      task <- TaskDAO.peekNextAssignment(user._id, teamIds) ?~> Messages("task.unavailable")
      taskJson <- task.publicWrites(GlobalAccessContext)
    } yield Ok(taskJson)
  }


  def listExperienceDomains = SecuredAction.async { implicit request =>
    for {
      experienceDomains <- TaskDAO.listExperienceDomains
    } yield Ok(Json.toJson(experienceDomains))
  }
}
