package models.task

import models.basics._
import java.util.Date
import com.scalableminds.util.geometry.Point3D

import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import play.api.Logger
import models.user.{User, Experience}
import models.annotation._
import play.api.libs.iteratee.Enumerator
import play.api.libs.json.{JsArray, JsNull, Json, JsObject}
import com.scalableminds.util.mvc.Formatter
import scala.concurrent.duration._
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.util.reactivemongo.{DefaultAccessDefinitions, GlobalAccessContext, DBAccessContext}
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._
import org.joda.time.DateTime
import org.joda.time.format.DateTimeFormat
import java.text.SimpleDateFormat
import scala.async.Async._
import akka.actor.Props
import reactivemongo.api.indexes.{IndexType, Index}
import reactivemongo.core.commands.LastError
import com.scalableminds.util.reactivemongo.AccessRestrictions.{AllowIf, DenyEveryone}

case class OpenAssignment(
  _task: BSONObjectID,
  team: String,
  _project: String,
  neededExperience: Experience = Experience.empty,
  priority: Int = 100,
  created: DateTime = DateTime.now(),
  _id: BSONObjectID = BSONObjectID.generate
  ) extends FoxImplicits {

  lazy val id = _id.stringify

  def task(implicit ctx: DBAccessContext) =
    TaskDAO.findOneById(_task)

  def hasEnoughExperience(user: User) = {
    neededExperience.isEmpty || user.experiences.get(neededExperience.domain).exists(_ >= neededExperience.value)
  }
}

object OpenAssignment extends FoxImplicits {
  implicit val openAssignmentFormat = Json.format[OpenAssignment]

  def from(task: Task): OpenAssignment =
    OpenAssignment(task._id, task.team, task._project, task.neededExperience, task.priority)
}

object OpenAssignmentDAO extends SecuredBaseDAO[OpenAssignment] with FoxImplicits {

  val collectionName = "openAssignments"

  val formatter = OpenAssignment.openAssignmentFormat

  underlying.indexesManager.ensure(Index(Seq("_task" -> IndexType.Ascending)))
  underlying.indexesManager.ensure(Index(Seq("_project" -> IndexType.Ascending)))
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
  }

  def byPriority =
    Json.obj("priority" -> -1)

  private def experiencesToQuery(user: User) =
    JsArray(user.experiences.map{ case (domain, value) => Json.obj("neededExperience.domain" -> domain, "neededExperience.value" -> Json.obj("$lte" -> value))}.toSeq)

  private def noRequiredExperience =
    Json.obj("neededExperience.domain" -> "", "neededExperience.value" -> 0)

  def findOrderedByPriority(user: User)(implicit ctx: DBAccessContext): Enumerator[OpenAssignment] = {
    find(Json.obj(
      "$or" -> (experiencesToQuery(user) :+ noRequiredExperience)))
    .sort(byPriority).cursor[OpenAssignment]().enumerate()
  }

  def findOrderedByPriority(implicit ctx: DBAccessContext): Enumerator[OpenAssignment] = {
    find().sort(byPriority).cursor[OpenAssignment]().enumerate()
  }

  def countFor(_task: BSONObjectID)(implicit ctx: DBAccessContext) = {
    count(Json.obj("_task" -> _task))
  }

  def countForProject(project: String)(implicit ctx: DBAccessContext) = {
    count(Json.obj("_project" -> project))
  }

  def removeByTask(_task: BSONObjectID)(implicit ctx: DBAccessContext) = {
    remove(Json.obj("_task" -> _task))
  }

  def removeByProject(_project: String)(implicit ctx: DBAccessContext) = {
    remove(Json.obj("_project" -> _project))
  }

  def countOpenAssignments(implicit ctx: DBAccessContext) = {
    count(Json.obj())
  }

  def updateAllOf(task: Task)(implicit ctx: DBAccessContext) = {
    update(Json.obj("_task" -> task._id), Json.obj("$set" -> Json.obj(
      "team" -> task.team,
      "project" -> task._project,
      "neededExperience" -> task.neededExperience,
      "priority" -> task.priority
    )),multi = true)
  }
}
