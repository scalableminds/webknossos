package braingames.levelcreator

import akka.actor.Actor
import akka.agent.Agent
import scala.collection.immutable.Queue
import java.util.UUID
import scala.concurrent.duration._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.Logger
import braingames.util.StartableActor
import models.knowledge.Stack

case class CreateStack(stack: Stack)
case class RequestWork()
case class StackGenerationChallenge(challenge: CreateStack, responseKey: String)
case class FinishWork(responseKey: String)

class StackWorkDistributor extends Actor {
  val maxStackGenerationTime = 30 minutes

  implicit val sys = context.system

  val inProgressStacks = Agent[Map[String, CreateStack]](Map.empty)

  val stackQueue = Agent[Queue[CreateStack]](Queue.empty)

  def receive = {
    case s: CreateStack =>
      stackQueue.send(_.enqueue(s))

    case FinishWork(responseKey) =>
      inProgressStacks.send(_ - responseKey)

    case RequestWork() =>
      val q = stackQueue()
      if (q.isEmpty) {
        val (s, _) = q.dequeue
        stackQueue.send { q =>
          if (!q.isEmpty)
            q.dequeue._2
          else
            q
        }
        val responseKey = UUID.randomUUID().toString()
        inProgressStacks.send(_ + (responseKey -> s))

        sys.scheduler.scheduleOnce(maxStackGenerationTime) {
          inProgressStacks().get(responseKey).map { s =>
            inProgressStacks.send(_ - responseKey)
            stackQueue.send(_.enqueue(s))
            Logger.warn(s"Stack was not completed! Key: $responseKey Stack: $s")
          }
        }

        sender ! Some(StackGenerationChallenge(s, responseKey))
      } else {
        sender ! None
      }
  }
}

object StackWorkDistributor extends StartableActor[StackWorkDistributor] {
  val name = "stackWorkDistributor"
}