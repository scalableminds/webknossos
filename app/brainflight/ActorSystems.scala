package brainflight

import com.typesafe.config.ConfigFactory
import akka.actor.ActorSystem
import scala.collection.JavaConversions._
import play.api.libs.concurrent.Akka

trait CommonActors{
  lazy val app = play.api.Play.current
  lazy val temporaryTracingGenerator = Akka.system(app).actorFor(s"/user/temporaryTracingGenerator")
}

object ActorSystems {
  lazy val dataRequestSystem = 
    ActorSystem("DataRequests", ConfigFactory.load().getConfig("datarequest"))
}