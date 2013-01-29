package models.task

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import models.basics._
import com.novus.salat.annotations._
import models.user.User

case class Project(@Key("name") name: String, _owner: ObjectId) extends DAOCaseClass[Project]{
  val dao = Project
  
  def owner = User.findOneById(_owner)
  
  lazy val tasks = Task.findAllByProject(name)
}

object Project extends BasicDAO[Project]("projects"){
  
  def findOneByName(name: String) = {
    findOne(MongoDBObject("name" -> name))
  }
}