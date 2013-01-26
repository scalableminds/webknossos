package models.task

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import models.basics._
import com.novus.salat.annotations._

case class Project(@Key("name") name: String) extends DAOCaseClass[Project]{
  val dao = Project
  
  lazy val tasks = Task.findAllByProject(name)
}

object Project extends BasicDAO[Project]("projects"){
  def findOneByName(name: String) = {
    findOne(MongoDBObject("name" -> name))
  }
}