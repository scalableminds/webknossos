package models.basics

import com.mongodb.casbah.commons.MongoDBObject
import scala.collection.JavaConversions._
import play.api.Logger

trait DAOCaseClass[T <: AnyRef] { this: T =>

  def dao: BasicDAO[T]

  val ID = "_id"
    
  def update(f: T => T) = {
    val transformed = f(this)
    val before = dao._grater.asDBObject(this).toMap
    val after = dao._grater.asDBObject(transformed)

    before.map{ 
      case (key: String, value: Any) =>
        val afterValue = after.get(key)
        if(afterValue == before.get(key)){
          after.removeField(key)
        }
      case _ =>
        Logger.error("DAO case class incremental update: before contains strange tuple!")
    }
    
    Option(before.get(ID)).map { id =>
      println("updateDBO: " + after)
      dao.update(MongoDBObject(ID -> id), MongoDBObject("$set" -> after), false, false)
    }

    transformed
  }
}