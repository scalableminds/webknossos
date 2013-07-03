package models.team

import models.basics.BasicDAO
import models.binary.DataSet
import org.bson.types.ObjectId
import com.mongodb.casbah.commons.MongoDBObject

case class Team(name: String, _id: ObjectId = new ObjectId)

object Team extends BasicDAO[Team]("teams") {
  def default = Team("Structure of Neocortical Circuits Group")
  
  def findOneByName(name: String) = 
    findOne(MongoDBObject("name" -> name))
}