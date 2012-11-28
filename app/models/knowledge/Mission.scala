package models.knowledge

import models.basics.DAOCaseClass
import models.basics.BasicDAO
import brainflight.tools.geometry.Point3D
import org.bson.types.ObjectId

case class Mission(start: MissionStart, end: Point3D, dataSetName: String,  propableSolutions: Map[Int, Int], _id: ObjectId = new ObjectId) extends DAOCaseClass[Mission]{
  val dao = Mission
}

object Mission extends BasicKnowledgeDAO[Mission]("mission"){
  
}