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
  numberOfOpenAssignments: Int,
  numberOfInProgressAssignments: Int,
  created: DateTime = DateTime.now(),
  annotations: List[MTurkAnnotationReference] = Nil,
  _id: BSONObjectID = BSONObjectID.generate
) extends FoxImplicits {

  lazy val id = _id.stringify

  def numberOfUnfinished = numberOfOpenAssignments + numberOfInProgressAssignments

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

  def countForProject(project: String)(implicit ctx: DBAccessContext) = {
    count(Json.obj("_project" -> project))
  }

  def findOneByTask(_task: BSONObjectID)(implicit ctx: DBAccessContext) = {
    findOne(Json.obj("_task" -> _task))
  }

  def findByKey(key: String)(implicit ctx: DBAccessContext) = {
    findOne(Json.obj("key" -> key))
  }

  def findByHITId(hitId: String)(implicit ctx: DBAccessContext) = {
    findOne(Json.obj("hitId" -> hitId))
  }

  def appendReference(_assignment: BSONObjectID, reference: MTurkAnnotationReference)(implicit ctx: DBAccessContext) = {
    update(Json.obj("_id" -> _assignment), Json.obj("$push" -> Json.obj("annotations" -> reference)))
  }

  def increaseNumberOfOpen(hitId: String, inc: Int)(implicit ctx: DBAccessContext) = {
    update(Json.obj("hitId" -> hitId), Json.obj("$inc" -> Json.obj("numberOfOpenAssignments" -> inc)))
  }

  def decreaseNumberOfOpen(hitId: String, dec: Int)(implicit ctx: DBAccessContext) = {
    increaseNumberOfOpen(hitId, -dec)
  }

  def increaseNumberInProgress(hitId: String, inc: Int)(implicit ctx: DBAccessContext) = {
    update(Json.obj("hitId" -> hitId), Json.obj("$inc" -> Json.obj("numberOfInProgressAssignments" -> inc)))
  }

  def decreaseNumberInProgress(hitId: String, dec: Int)(implicit ctx: DBAccessContext) = {
    increaseNumberInProgress(hitId, -dec)
  }

  def setToZeroOpen(_id: BSONObjectID)(implicit ctx: DBAccessContext) = {
    update(Json.obj("_id" -> _id), Json.obj("$set" -> Json.obj("numberOfOpenAssignments" -> 0)))
  }
}
