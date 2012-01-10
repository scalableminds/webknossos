package integration

import org.specs2.mutable._
import play.api.test._
import play.api.test.Helpers._
import brainflight.binary.CubeModel
import play.api.libs.json._
import scala.util.Random
import play.api.mvc._

object RouteTest extends Specification {
  sequential

  "Route REST interface" should {
    
    var routeID: String = "2ef481781364831b59747dbb"
    
    "grab a new route ID" in {
      running( FakeApplication() ) {
        val Some( result ) = routeAndCall( FakeRequest(
          GET,
          "/route/initialize") )
        status( result ) must be equalTo( OK )
        contentType( result ) must equalTo( Some( "application/json" ) )
        /* json should look like 
         * {
         * 	"id":"4f0b23db03643808cbb76e73",
         * 	"position":[1.0,1.0,1.0],
         * 	"direction":[1.0,1.0,1.0]
         * }
         */
        val json = Json.parse(contentAsString( result ))
        
        (json \ "id").asOpt[String] match {
          case Some(id) => 
            routeID = id
            ok
          case None =>
            ko
        }
        (json \ "position").asOpt[List[Int]] must beSome
        (json \ "direction").asOpt[List[Int]] must beSome 
      }
    }
    
    "handle long POST requests" in {
      running( FakeApplication() ) {
        val r = new Random
        var s =
          ( ( 1 to 100000 ) map { i =>
            List( r.nextDouble * 100, r.nextDouble * 100, r.nextDouble * 100 )
          } ).toList
        // test with random not necessary usefull routeid
        val Some( result ) = routeAndCall( FakeRequest(
          "POST",
          "/route/"+routeID,
          FakeHeaders(),
          toJson( s ) ) )
        status( result ) must not be equalTo( REQUEST_ENTITY_TOO_LARGE )
        status( result ) must be equalTo( OK )
      }
    }

    "return connected route" in {
      running( FakeApplication() ) {
        val Some( result ) = routeAndCall( FakeRequest(
          GET,
          "/route/"+routeID) )
        status( result ) must be equalTo( OK )
        contentType( result ) must equalTo( Some( "application/json" ) )
      }
    }
  }
}
