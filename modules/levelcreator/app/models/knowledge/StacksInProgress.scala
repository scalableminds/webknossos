package models.knowledge

import play.modules.reactivemongo.json.BSONFormats._
import play.api.libs.json._
import scala.concurrent.duration.FiniteDuration
import models.knowledge.basics.BasicReactiveDAO
import reactivemongo.api.indexes.{IndexType, Index}
import braingames.reactivemongo.DBAccessContext
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.bson.BSONObjectID
import reactivemongo.core.commands.Count

case class StackInProgress(
  key: String,
  _level: LevelId,
  _mission: BSONObjectID,
  timestamp: Long = System.currentTimeMillis,
  _id: BSONObjectID = BSONObjectID.generate) {

  def level(implicit ctx: DBAccessContext) = LevelDAO.findOneById(_level)

  val id = _id.stringify

  def mission(implicit ctx: DBAccessContext) = MissionDAO.findOneById(_mission)
}

trait StackInProgressFormats{
  implicit val formatter = Json.format[StackInProgress]
}

object StackInProgressDAO extends BasicReactiveDAO[StackInProgress] with StackInProgressFormats{
  val collectionName = "stacksInProgress"


  this.collection.indexesManager.ensure(Index(Seq(
    "key" -> IndexType.Ascending)))

  this.collection.indexesManager.ensure(Index(Seq(
    "_level" -> IndexType.Ascending,
    "_mission" -> IndexType.Ascending)))

  def findAllOlderThan(d: FiniteDuration)(implicit ctx: DBAccessContext) = {
    val t = System.currentTimeMillis() - d.toMillis
    collectionFind(Json.obj(
      "timestamp" -> Json.obj("$lt" -> t))).cursor[StackInProgress].toList
  }

  def findOneByKey(key: String)(implicit ctx: DBAccessContext) = {
    collectionFind(Json.obj("key" -> key)).one[StackInProgress]
  }

  def findFor(levelId: LevelId)(implicit ctx: DBAccessContext) = {
    collectionFind(Json.obj(
      "_level.name" -> levelId.name,
      "_level.version" -> levelId.version)).cursor[StackInProgress].toList
  }

  def countFor(levelName: String)(implicit ctx: DBAccessContext) = {
    count(Json.obj("_level.name" -> levelName))
  }

  def find(level: Level, mission: Mission)(implicit ctx: DBAccessContext) = {
    collectionFind(Json.obj(
      "_level.name" -> level.levelId.name,
      "_level.version" -> level.levelId.version,
      "_mission" -> mission._id)).cursor[StackInProgress].toList
  }
}