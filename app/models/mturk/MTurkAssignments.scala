/*
 * Copyright (C) Tom Bocklisch <https://github.com/tmbo>
 */
package models.mturk

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.FoxImplicits
import models.basics.SecuredBaseDAO
import models.task.TaskDAO
import org.joda.time.DateTime
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import reactivemongo.api.indexes.{Index, IndexType}
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._


case class MTurkAssignment(
  _task: BSONObjectID,
  team: String,
  _project: String,
  hitId: String,
  key: String,
  created: DateTime = DateTime.now(),
  annotations: List[MTurkAnnotationReference] = Nil,
  _id: BSONObjectID = BSONObjectID.generate
) extends FoxImplicits {

  lazy val id = _id.stringify

  def task(implicit ctx: DBAccessContext) =
    TaskDAO.findOneById(_task)
}

object MTurkAssignment extends FoxImplicits {
  implicit val mturkAssignmentFormat = Json.format[MTurkAssignment]
}

object MTurkAssignmentDAO extends SecuredBaseDAO[MTurkAssignment] with FoxImplicits {

  val collectionName = "mturkAssignments"

  val formatter = MTurkAssignment.mturkAssignmentFormat

  underlying.indexesManager.ensure(Index(Seq("_task" -> IndexType.Ascending)))
  underlying.indexesManager.ensure(Index(Seq("_project" -> IndexType.Ascending)))
  underlying.indexesManager.ensure(Index(Seq("key" -> IndexType.Descending)))
  underlying.indexesManager.ensure(Index(Seq("hitId" -> IndexType.Descending)))

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

  def findByProject(_project: String)(implicit ctx: DBAccessContext) = {
    find(Json.obj("_project" -> _project)).cursor[MTurkAssignment]().collect[List]()
  }

  def findByKey(key: String)(implicit ctx: DBAccessContext) = {
    findOne(Json.obj("key" -> key))
  }

  def findByHITId(hitId: String)(implicit ctx: DBAccessContext) = {
    findOne(Json.obj("hitId" -> hitId))
  }

  def countOpenAssignments(implicit ctx: DBAccessContext) = {
    count(Json.obj())
  }

  def appendReference(_assignment: BSONObjectID, reference: MTurkAnnotationReference)(implicit ctx: DBAccessContext) = {
    update(Json.obj("_id" -> _assignment), Json.obj("$push" -> Json.obj("annotations" -> reference)))
  }
}
