package models.knowledge

import play.modules.reactivemongo.json.BSONFormats._
import play.api.libs.json._
import scala.concurrent.duration.FiniteDuration
import models.knowledge.basics.BasicReactiveDAO
import reactivemongo.api.indexes.{IndexType, Index}
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.bson.BSONObjectID
import braingames.reactivemongo.DBAccessContext

case class NextLevelVersion(name: String, nextVersion: Int, _id: BSONObjectID = BSONObjectID.generate) {
  val id = _id.stringify
}

object NextLevelVersion extends BasicReactiveDAO[NextLevelVersion] {
  val collectionName = "nextLevelVersions"
  implicit val formatter: OFormat[NextLevelVersion] = Json.format[NextLevelVersion]
  this.collection.indexesManager.ensure(Index(Seq("name"-> IndexType.Ascending)))

  def findVersionByName(name: String)(implicit ctx: DBAccessContext)  : Future[Option[Int]] = {
    findOne(Json.obj("name" -> name)).map(_.map(_.nextVersion))
  }

  def setVersionFor(name: String, nextVersion: Int)(implicit ctx: DBAccessContext) = {
    collectionUpdate(
      Json.obj("name" -> name),
      Json.obj("name" -> name, "nextVersion" -> nextVersion),
      upsert = true)
  }

  def getNextVersion(name: String)(implicit ctx: DBAccessContext) = {
    for{
      v <- findVersionByName(name).map(_ getOrElse 0)
      _ <- setVersionFor(name, v + 1)
    } yield {
      v
    }
  }
}