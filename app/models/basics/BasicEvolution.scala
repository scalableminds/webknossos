package models.basics

import models.DataSet
import models.User
import models.graph.Experiment
import org.bson.types.ObjectId
import play.api.Logger

object BasicEvolution {
  val watchedClasses = List(DataSet, User, Experiment)

  def runDBEvolution() {
    val fakeObjectId = new ObjectId
    watchedClasses.foreach { clazz =>
      try {
        clazz.findAll
      } catch {
        case e: java.lang.Exception =>
          val defaultValues = clazz.defaultValues
          
          
          
          //e.
          Logger.error("Got it")
      }
    }

  }
}