package REST

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
    "return even for long POST requests" in {
      running( FakeApplication() ) {
        val r = new Random
        var s =
          ( ( 1 to 100000 ) map { i =>
            List( r.nextDouble * 100, r.nextDouble * 100, r.nextDouble * 100 )
          } ).toList
        // test with random not necessary usefull objectid
        val Some( result ) = routeAndCall( FakeRequest(
          "POST",
          "/route/2ef481781364831b59747dbb",
          FakeHeaders(),
          toJson( s ) ) )
        status( result ) must not be equalTo( 413 )
      }
    }
  }
}
