package models.basics

import models.binary._
import models.user._
import models.task._
import models.security._
import org.bson.types.ObjectId
import play.api.Logger

object BasicEvolution {
  val watchedClasses: List[BasicDAO[_]] = List(Role, DataSet, User, Task, Experiment, TrainingsExperiment, TrainingsTask)

  def runDBEvolution() {
    val fakeObjectId = new ObjectId
    watchedClasses.foreach { clazz =>
      try {
        clazz.findAll
      } catch {
        case e: java.lang.Exception =>  
          clazz.collection.drop
          Logger.warn("Droped '%s' collection because of schema / grater inconsistency".format(clazz))
      }
    }
  }
}