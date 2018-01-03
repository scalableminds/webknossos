package models.task

import com.scalableminds.webknossos.datastore.tracings.TracingType
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.reactivemongo.AccessRestrictions.{AllowIf, DenyEveryone}
import com.scalableminds.util.reactivemongo.{DBAccessContext, DefaultAccessDefinitions, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation._
import models.basics._
import models.project.{Project, ProjectDAO}
import models.user.{Experience, User}
import org.joda.time.DateTime
import org.joda.time.format.DateTimeFormat
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.iteratee.Enumerator
import play.api.libs.json.{JsArray, JsNull, JsObject, Json}
import reactivemongo.api.collections.bson.BSONCollection
import reactivemongo.api.commands.WriteResult
import reactivemongo.api.indexes.{Index, IndexType}
import reactivemongo.bson.{BSONObjectID, BSONString}
import reactivemongo.play.json.BSONFormats._

case class OpenInstancesResult(_id: String, openInstances: Int)
object OpenInstancesResult { implicit val format = Json.format[OpenInstancesResult] }

class info(message: String) extends scala.annotation.StaticAnnotation

case class Task(
                 @info("Reference to task type") _taskType: BSONObjectID,
                 @info("Assigned name") team: String,
                 @info("Required experience") neededExperience: Experience = Experience.empty,
                 @info("Number of total instances") instances: Int = 1,
                 @info("Number of open (=remaining =unassigned) instances") openInstances: Int = 1,
                 @info("Bounding Box (redundant to base tracing)") boundingBox: Option[BoundingBox] = None,
                 @info("Start point edit position (redundant to base tracing)") editPosition: Point3D,
                 @info("Start point edit rotation (redundant to base tracing)") editRotation: Vector3D,
                 @info("Current tracing time") tracingTime: Option[Long] = None,
                 @info("Date of creation") created: DateTime = DateTime.now(),
                 @info("Flag indicating deletion") isActive: Boolean = true,
                 @info("Reference to project") _project: String,
                 @info("Script to be executed on task start") _script: Option[String],
                 @info("Optional information on the tasks creation") creationInfo: Option[String] = None,
                 @info("Priority for users fetching new tasks") priority: Int = 100,
                 @info("Unique ID") _id: BSONObjectID = BSONObjectID.generate
               ) extends FoxImplicits {

  lazy val id = _id.stringify

  def taskType(implicit ctx: DBAccessContext) = TaskTypeDAO.findOneById(_taskType)(GlobalAccessContext).toFox

  def project(implicit ctx: DBAccessContext) =
    ProjectDAO.findOneByName(_project)

  def annotations(implicit ctx: DBAccessContext) =
    AnnotationService.annotationsFor(this)

  def settings(implicit ctx: DBAccessContext) =
    taskType.map(_.settings) getOrElse AnnotationSettings.defaultFor(TracingType.skeleton)

  def annotationBase(implicit ctx: DBAccessContext) =
    AnnotationService.baseFor(this)

  def inProgress(implicit ctx: DBAccessContext) =
    AnnotationService.countUnfinishedAnnotationsFor(this)

  def status(implicit ctx: DBAccessContext) = {
    for {
      inProgress <- inProgress.getOrElse(0)
    } yield CompletionStatus(
      open = openInstances,
      inProgress = inProgress,
      completed = instances - (inProgress + openInstances))
  }

  def hasEnoughExperience(user: User) = {
    neededExperience.isEmpty || user.experiences.get(neededExperience.domain).exists(_ >= neededExperience.value)
  }
}

object Task extends FoxImplicits {
  implicit val taskFormat = Json.format[Task]

  def transformToJsonFoxed(taskFox: Fox[Task], otherFox: Fox[_])(implicit ctx: DBAccessContext): Fox[JsObject] = {
    for {
      _ <- otherFox
      task <- taskFox
      js <- transformToJson(task)
    } yield js
  }

  def transformToJson(task: Task)(implicit ctx: DBAccessContext): Fox[JsObject] = {
    for {
      dataSetName <- task.annotationBase.map(_.dataSetName)
      status <- task.status.getOrElse(CompletionStatus(-1, -1, -1))
      scriptInfo <- task._script.toFox.flatMap(sid => ScriptDAO.findOneById(sid)).futureBox
      tt <- task.taskType.map(TaskType.transformToJson) getOrElse JsNull
      scriptJs <- scriptInfo.toFox.flatMap(s => Script.scriptPublicWrites(s)).futureBox
    } yield {
      Json.obj(
        "id" -> task.id,
        "team" -> task.team,
        "formattedHash" -> Formatter.formatHash(task.id),
        "projectName" -> task._project,
        "type" -> tt,
        "dataSet" -> dataSetName,
        "neededExperience" -> task.neededExperience,
        "created" -> DateTimeFormat.forPattern("yyyy-MM-dd HH:mm").print(task.created),
        "status" -> status,
        "script" -> scriptJs.toOption,
        "tracingTime" -> task.tracingTime,
        "creationInfo" -> task.creationInfo,
        "boundingBox" -> task.boundingBox,
        "editPosition" -> task.editPosition,
        "editRotation" -> task.editRotation
      )
    }
  }
}

object TaskDAO extends SecuredBaseDAO[Task] with FoxImplicits with QuerySupportedDAO[Task] {

  val collectionName = "tasks"

  val formatter = Task.taskFormat

  underlying.indexesManager.ensure(Index(Seq("_project" -> IndexType.Ascending)))
  underlying.indexesManager.ensure(Index(Seq("team" -> IndexType.Ascending)))
  underlying.indexesManager.ensure(Index(Seq("_taskType" -> IndexType.Ascending)))
  underlying.indexesManager.ensure(Index(Seq("_user" -> IndexType.Ascending, "_task" -> IndexType.Ascending)))
  underlying.indexesManager.ensure(Index(Seq("priority" -> IndexType.Descending)))
  underlying.indexesManager.ensure(Index(Seq("team" -> IndexType.Ascending, "neededExperience" -> IndexType.Ascending, "priority" -> IndexType.Descending)))


  override val AccessDefinitions = new DefaultAccessDefinitions {

    override def findQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match {
        case Some(user: User) =>
          AllowIf(Json.obj("team" -> Json.obj("$in" -> user.teamNames)))
        case _ =>
          DenyEveryone()
      }
    }

    override def removeQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match {
        case Some(user: User) =>
          AllowIf(Json.obj("team" -> Json.obj("$in" -> user.adminTeamNames)))
        case _ =>
          DenyEveryone()
      }
    }
  }

  override def find(query: JsObject = Json.obj())(implicit ctx: DBAccessContext) = {
    super.find(query ++ Json.obj("isActive" -> true))
  }

  override def findOne(query: JsObject = Json.obj())(implicit ctx: DBAccessContext) = {
    super.findOne(query ++ Json.obj("isActive" -> true))
  }

  def findAllAdministratable(user: User, limit: Int)(implicit ctx: DBAccessContext) = withExceptionCatcher {
    find(Json.obj(
      "team" -> Json.obj("$in" -> user.adminTeamNames))).cursor[Task]().collect[List](maxDocs = limit)
  }

  def removeAllWithProject(project: Project)(implicit ctx: DBAccessContext) = {
    project.tasks.map(_.map(task => {
      removeById(task._id)
    }))
  }

  def findAllByTaskType(_taskType: BSONObjectID)(implicit ctx: DBAccessContext) = withExceptionCatcher {
    find("_taskType", _taskType).collect[List]()
  }

  def findAllByProject(project: String)(implicit ctx: DBAccessContext) = withExceptionCatcher {
    find("_project", project).collect[List]()
  }

  def sumInstancesByProject(project: String)(implicit ctx: DBAccessContext) = withExceptionCatcher {
    sumValues(Json.obj("_project" -> project), "instances")
  }

  def findAllByProjectReturnOnlyIds(project: String)(implicit ctx: DBAccessContext) = {
    for {
      jsObjects <- findWithProjection(Json.obj("_project" -> project), Json.obj("_id" -> 1)).cursor[JsObject]().collect[List]()
    } yield {
      jsObjects.map(p => (p \ "_id").asOpt[BSONObjectID]).flatten
    }
  }

  def findOneByProject(projectName: String)(implicit ctx: DBAccessContext) = findOne(Json.obj("_project" -> projectName))

  def findAllByProjectTaskTypeIds(projectOpt: Option[String], taskTypeOpt: Option[String], idsOpt: Option[List[String]])(implicit ctx: DBAccessContext) = withExceptionCatcher {
    val projectFilter = projectOpt match {
      case Some(project) => Json.obj(("_project") -> Json.toJson(project))
      case None => Json.obj()
    }

    val taskTypeFilter = taskTypeOpt match {
      case Some(taskType) => Json.obj(("_taskType") -> Json.obj("$oid" -> taskType))
      case None => Json.obj()
    }

    val idsFilter = idsOpt match {
      case Some(ids) => Json.obj(("_id") -> Json.obj("$in" -> ids.filter(BSONObjectID.parse(_).isSuccess).map(id => Json.obj("$oid" -> id))))
      case None => Json.obj()
    }

    find(projectFilter ++ taskTypeFilter ++ idsFilter).cursor[Task]().collect[List]()
  }

  def removeScriptFromTasks(_script: String)(implicit ctx: DBAccessContext) = withExceptionCatcher {
    update(Json.obj("_script" -> _script), Json.obj("$unset" -> Json.obj("_script" -> 1)), multi = true)
  }

  def logTime(time: Long, _task: BSONObjectID)(implicit ctx: DBAccessContext) =
    update(Json.obj("_id" -> _task), Json.obj("$inc" -> Json.obj("tracingTime" -> time)))

  def updateInstances(
                     _task: BSONObjectID,
                     instances: Int,
                     openInstances: Int
                     )(implicit ctx: DBAccessContext): Fox[Task] =
    findAndModify(
      Json.obj("_id" -> _task),
      Json.obj("$set" ->
        Json.obj(
          "instances" -> instances,
          "openInstances" -> openInstances)),
    returnNew = true)


  def updateAllOfProject(updatedProject: Project)(implicit ctx: DBAccessContext) = {
    update(Json.obj("_project" -> updatedProject.name), Json.obj("$set" -> Json.obj(
      "priority" -> (if(updatedProject.paused) -1 else updatedProject.priority)
    )), multi = true)
  }

  def decrementOpenInstanceCount(id: BSONObjectID)(implicit ctx: DBAccessContext) = Fox[WriteResult] {
    update(
      Json.obj("_id" -> id, "openInstances" -> Json.obj("$gt" -> 0)),
      Json.obj("$inc" -> Json.obj("openInstances" -> -1))
    )
  }

  def incrementOpenInstanceCount(id: BSONObjectID)(implicit ctx: DBAccessContext) = Fox[WriteResult] {
    update(
      Json.obj("_id" -> id),
      Json.obj("$inc" -> Json.obj("openInstances" -> 1))
    )
  }

  private def validPriorityQ =
    Json.obj("priority" -> Json.obj("$gte" -> 0))

  private def experienceQueryFor(user: User) =
    JsArray(user.experiences.map {
      case (domain, value) => Json.obj("neededExperience.domain" -> domain, "neededExperience.value" -> Json.obj("$lte" -> value))
    }.toSeq)

  private def noRequiredExperience =
    Json.obj("neededExperience.domain" -> "", "neededExperience.value" -> 0)

  def findOrderedByPriorityFor(user: User, teams: List[String])(implicit ctx: DBAccessContext): Enumerator[Task] = {
    def byPriority =
      Json.obj("priority" -> -1)

    find(validPriorityQ ++ Json.obj(
      "instances" -> Json.obj("$gt" -> 0),
      "team" -> Json.obj("$in" -> teams),
      "$or" -> (experienceQueryFor(user) :+ noRequiredExperience)))
      .sort(byPriority)
      .cursor[Task]()
      .enumerate(stopOnError = true)
  }

  def countOpenInstancesByProjects(implicit ctx: DBAccessContext) = {
    countOpenInstances("$_project")
  }

  def countAllOpenInstances(implicit ctx: DBAccessContext) = {
    countOpenInstances("all").map(_.get("all"))
  }

  def countOpenInstances(groupingField: String = "1")(implicit ctx: DBAccessContext) = {
    val dao =  underlying.db.collection[BSONCollection]("tasks")
    import dao.BatchCommands.AggregationFramework._

    dao.aggregate(
      Group(BSONString(groupingField))( "openInstances" -> SumField("instances"))
    ).map{result => Json.toJson(result.firstBatch).as[List[OpenInstancesResult]].map( x => x._id -> x.openInstances).toMap }
  }

  def findByUserReturnOnlyProject(user: User)(implicit ctx: DBAccessContext) = {
    for {
      jsObjects <- findWithProjection(validPriorityQ ++ Json.obj(
        "instances" -> Json.obj("$gt" -> 0),
        "team" -> Json.obj("$in" -> user.teamNames),
        "$or" -> (experienceQueryFor(user) :+ noRequiredExperience)), Json.obj("_project" -> 1, "_id" -> 0)).cursor[JsObject]().collect[List]()
    } yield {
      jsObjects.map(p => (p \ "_project").asOpt[String]).flatten
    }
  }

  def executeUserQuery(q: JsObject, limit: Int)(implicit ctx: DBAccessContext): Fox[List[Task]] = withExceptionCatcher {
    // Can't use local find, since it appends `isActive = true` to the query!
    super.find(q).cursor[Task]().collect[List](maxDocs = limit)
  }
}
