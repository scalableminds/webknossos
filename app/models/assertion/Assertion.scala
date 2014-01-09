package models.assertion

import models.basics._
import org.bson.types.ObjectId
import models.user.User
import play.api.libs.json.JsObject

case class Assertion(_user: Option[ObjectId], timestamp: Long, value: String, title: String, message: String, stacktrace: String, globalContext: String, localContext: String, _id: ObjectId = new ObjectId) extends DAOCaseClass[Assertion]{
  val dao = Assertion
  
  def id = _id.toString
  
  def user = _user.flatMap(User.findOneById)
}

object Assertion extends BasicDAO[Assertion]("assertions"){
  
}