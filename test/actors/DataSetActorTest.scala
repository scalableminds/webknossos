package actors

import org.specs2.mutable.AkkaSpecification
import akka.actor._
import akka.util.duration._
import akka.actor.ActorSystem
import akka.testkit.TestActorRef
import akka.testkit.TestKit
import akka.pattern.ask
import akka.actor.Props
import oxalis.binary.DataSetActor
import play.api.test._
import play.api.test.Helpers._
import oxalis.binary.{ SingleRequest, CubeRequest }
import braingames.geometry.Point3D
import akka.util.Timeout
import models.DataSet
import play.libs.Akka._
import play.api.libs.concurrent._
import braingames.geometry.Cube

class DataSetActorTest extends AkkaSpecification {

  implicit val system = akkaTestSystem( config )
  implicit val timeout = Timeout( 500 millis )

  
  "A DataSetActor " should {
    "responde to a single data request" in new setup {
      running( FakeApplication() ) {
        val dataSetActor = system.actorOf( Props[DataSetActor] )
        val result = dataSetActor ? SingleRequest( DataSet.default, 1, Point3D( 0, 0, 0 ) )
        
        await(result.asPromise) must be equalTo 0
      }
    }

    "responde to a block data request" in new setup {
      running( FakeApplication() ) {
        val dataSetActor = system.actorOf( Props[DataSetActor] )
        val result = dataSetActor ? CubeRequest( DataSet.default, 1, Cube(Point3D( 0, 0, 0 ), 1 ) )
   
        await(result.asPromise) must be equalTo Array(0)
      }
    }
  }
}