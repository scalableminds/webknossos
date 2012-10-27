package models

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import models.basics.BasicDAO
import java.util.Date
import brainflight.tools.geometry.Point3D
import models.graph.Experiment

case class Task(
    taskID: Int, 
    zellId: Int, 
    start: Point3D, 
    priority: Int, 
    created: Date, 
    experiment: Option[Experiment],
    completedBy: Option[ObjectId],
    _id: ObjectId = new ObjectId) {
  def id = _id.toString
}

object Task extends BasicDAO[Task]("tasks"){
  
}