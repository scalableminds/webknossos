package models.basics

import play.api.libs.concurrent.Akka
import play.api.Play
import akka.agent.Agent
      import play.api.libs.concurrent.Execution.Implicits._
/**
 * Company: scalableminds
 * User: tmbo
 * Date: 29.10.13
 * Time: 14:36
 */
trait TemporaryStore[T] {
  implicit val sys = Akka.system(Play.current)
  lazy val ts = Agent[Map[String, T]](Map())

  def find(id: String) =
    ts().get(id)

  def findAll =
    ts().values.toList

  def removeAllExcept(l: Array[String]) =
    ts.send( _.filterKeys( l.contains))

  def insert(id: String, t: T) =
    ts.send(_ + (id -> t))

  def remove(id: String) =
    ts.send(_ - id)
}