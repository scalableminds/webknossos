package models.knowledge

import models.basics.BasicDAO
import org.bson.types.ObjectId
import play.api.libs.json.Format
import play.api.libs.json._
import play.api.libs.functional.syntax._
import models.basics.DAOCaseClass
import scala.concurrent.duration.FiniteDuration
import com.mongodb.casbah.commons.MongoDBObject

case class NextLevelVersion(name: String, nextVersion: Int, _id: ObjectId = new ObjectId) extends DAOCaseClass[NextLevelVersion] {
  val id = _id.toString
  val dao = NextLevelVersion
}

object NextLevelVersion extends BasicDAO[NextLevelVersion]("nextLevelVersions") {
  this.collection.ensureIndex("name")

  def findVersionByName(name: String) = {
    findOne(MongoDBObject("name" -> name)).map(_.nextVersion)
  }

  def setVersionFor(name: String, nextVersion: Int) = {
    update(
      MongoDBObject("name" -> name),
      MongoDBObject("name" -> name, "nextVersion" -> nextVersion),
      upsert = true)
  }

  def getNextVersion(name: String) = {
    val v = findVersionByName(name) getOrElse 0
    setVersionFor(name, v + 1)
    v
  }
}