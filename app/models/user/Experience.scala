package models.user

import models.task.TrainingsTask

object Experience {
  
  type Experiences = Map[String, Int]
  
  def findAll = TrainingsTask.findAll.map(_.experience).toSet.toList
}