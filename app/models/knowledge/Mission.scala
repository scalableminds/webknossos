package models.knowledge

import models.basics.DAOCaseClass
import models.basics.BasicDAO

case class Mission() extends DAOCaseClass[Mission]{
  val dao = Mission
}

object Mission extends BasicKnowledgeDAO[Mission]("mission"){
  
}