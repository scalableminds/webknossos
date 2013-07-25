package braingames.util

import akka.actor.ActorRef
import akka.actor.Props
import akka.actor.Actor
import scala.reflect.ClassTag

trait StartableActor[T <: Actor] {
  def name: String
  def start(implicit sys: akka.actor.ActorSystem, tag: ClassTag[T]) =
    sys.actorOf(Props[T], name)
}