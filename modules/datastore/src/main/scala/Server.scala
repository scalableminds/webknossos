import akka.actor.ActorSystem
import akka.actor.Props
import akka.agent.Agent
import com.typesafe.config.ConfigFactory
import oxalis.binary._

object Server extends App {
  val conf = ConfigFactory.load()

  /*implicit val system = ActorSystem("DataStores", conf.getConfig("datastore"))
  
  system.actorOf(Props(new GridDataStore()), name = "gridDataStore")
  system.actorOf(Props(new FileDataStore()), name = "fileDataStore")
  
  println("Running...")
  system.awaitTermination*/
  println("Terminated!")
}