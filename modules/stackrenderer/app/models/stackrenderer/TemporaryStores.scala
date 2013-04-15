package models.stackrenderer

import akka.agent.Agent
import models.knowledge._
import models.binary.DataSet
import play.api.libs.concurrent.Akka
import play.api.Play

object TemporaryStores {
  
  val levelStore = new TemporaryStore[Level]
  val missionStore = new TemporaryStore[Mission]
  val dataSetStore = new TemporaryStore[DataSet]

  class TemporaryStore[T] {
    implicit val sys = Akka.system(Play.current)
    val ts = Agent[Map[String, T]](Map())
    
    def find(id: String) =
      ts().get(id)
      
    def removeAllExcept(l: Array[String]) =
      ts.send( _.filterKeys( l.contains))

    def insert(id: String, t: T) =
      ts.send(_ + (id -> t))

    def remove(id: String) =
      ts.send(_ - id)
  }
}