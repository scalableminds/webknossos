package models.basics

import com.mongodb.casbah.commons.MongoDBObject
import scala.collection.JavaConversions._
import play.api.Logger
import com.mongodb.DBObject

trait DAOCaseClass[T <: AnyRef] { this: T =>

  def dao: BasicDAO[T]

  val ID = "_id"

  def update(f: T => T) = {
    val transformed = f(this)
    val before = dao._grater.asDBObject(this).toMap
    val after = dao._grater.asDBObject(transformed)
    val unset = MongoDBObject.newBuilder

    before.map {
      case (key: String, value: Any) =>
        val afterValue = after.get(key)
        if (afterValue == before.get(key)) {
          after.removeField(key)
        }
        if(afterValue == null){
          unset += key -> 1
        }
      case _ =>
        Logger.error("DAO case class incremental update: before contains strange tuple!")
    }

    Option(before.get(ID)).map { id =>
      println("updateDBO: " + after)
      println("unset: " + unset)
      dao.update(
        MongoDBObject(ID -> id),
        MongoDBObject(
          "$set" -> after,
          "$unset" -> unset.result),
        false, false)
    }

    transformed
  }
}