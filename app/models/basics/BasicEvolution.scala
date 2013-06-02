package models.basics

import models.binary._
import models.user._
import models.task._
import models.security._
import org.bson.types.ObjectId
import play.api.Logger
import models.tracing._
import models.tracing.skeleton.Tracing

object BasicEvolution {
  val watchedClasses: List[BasicDAO[_]] = List(Role, User, Task, Tracing, UsedAnnotation)

  def runDBEvolution() {
    val fakeObjectId = new ObjectId
    watchedClasses.foreach { clazz =>
      try {
        clazz.findAll
      } catch {
        case e: java.lang.Exception =>  
          clazz.collection.drop
          Logger.warn(s"Droped '$clazz' collection because of schema / grater inconsistency")
      }
    }
  }
}