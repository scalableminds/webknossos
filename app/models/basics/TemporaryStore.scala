package models.basics

import akka.agent.Agent
import play.api.Play
import play.api.libs.concurrent.Akka
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

  def removeAll(): Unit =
    ts.send(Map.empty[String, T])

  def removeAllExcept(l: Array[String]): Unit =
    ts.send( _.filterKeys( l.contains))

  def insert(id: String, t: T): Unit =
    ts.send(_ + (id -> t))

  def insertAll(els: (String, T)*): Unit =
    ts.send(_ ++ els)

  def remove(id: String): Unit =
    ts.send(_ - id)
}
