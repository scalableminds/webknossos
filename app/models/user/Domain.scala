package models.user

import com.mongodb.casbah.Imports._
import models.basics._
import play.api.libs.json.{Json, JsObject}

case class Domain(domain: String) extends DAOCaseClass[Domain] {
  val dao = Domain
}

object Domain extends BasicDAO[Domain]("domains") {

  implicit val domainFormat = Json.format[Domain]
  
  def findOrCreate(name: String) = {
    update(MongoDBObject("domain" -> name), MongoDBObject("domain" -> name), true)
  }

  def findAllDistinct =
    findAll.distinct.map(_.domain)

}