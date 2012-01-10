package integration

import org.specs2.mutable._
import play.api.test._
import play.api.test.Helpers._
import brainflight.binary.CubeModel
import play.api.libs.json._
import scala.util.Random
import play.api.mvc._

object BinaryTest extends Specification {
  sequential

  "Binary REST interface" should {
    "return model" in {
      running( FakeApplication() ) {
        /**
         * URL:
         * 	GET - /route/model/:modeltype
         * Params:
         *  	- modeltype: String , A valid data source model (e.q. cube)
         * Response-type:
         * 	application/octet-stream
         * Response:
         * 	Coordinates of all points inside the model in 8 byte format.
         * 	3 Dimensional in the following order: x,y,z
         */
        val Some( result ) = routeAndCall( FakeRequest( "GET", "/binary/model/cube" ) )
        status( result ) must be equalTo ( OK )
        contentType( result ) must equalTo( Some( "application/octet-stream" ) )
        contentAsBytes( result ).foldLeft( 0 )( ( b, x ) => b + x ) must be equalTo CubeModel.modelInformation.foldLeft( 0 )( ( b, x ) => b + x )
      }
    }
    "return polygons" in {
      /**
       * URL:
       * 	GET - /route/polygons/:modeltype
       * Params:
       *  	- modeltype: String , A valid data source model (e.q. cube)
       * Response-type:
       * 	application/json
       * Response:
       * 	Polygons which build the hull of the passed model. The resulting
       * 	json is an array of polygons. Each polygon consists of a list of
       * 	edges each consisting of an array for the 3 dimensions(e.q. [1,2,3]).
       * 	<example>
       * 		[
       * 			[ // first polygon
       * 				[-25.0,0.0,25.0], //first edge
       * 				[-25.0,0.0,-25.0], //second edge
       * 				[-25.0,0.0,25.0]]  // ...
       * 			],
       * 			[ // second polygon ...
       * 	</example>
       */
      val Some( result ) = routeAndCall( FakeRequest( GET, "/binary/polygons/cube" ) )
      status( result ) must be equalTo ( OK )
      contentType( result ) must equalTo( Some( "application/json" ) )
      contentAsString(result) must be equalTo Json.stringify(toJson( CubeModel.polygons ))
    }
    "return data" in {
      running( FakeApplication() ) {
        /**
         * URL:
         * 	GET - /route/data/:modeltype
         * Params:
         *  	- modeltype: String , A valid data source model (e.q. cube)
         *  	- px: Int , x - Coordinate of the origin point
         *  	- py: Int , y - Coordinate of the origin point
         *  	- pz: Int , z - Coordinate of the origin point
         *  	- ax: Int , x - Coordinate of the view axis
         *  	- ay: Int , y - Coordinate of the view axis
         *  	- az: Int , z - Coordinate of the view axis
         * Response-type:
         * 	application/octet-stream
         * Response:
         * 	To calculate the response the given model gets rotateted and moved
         * 	to the given origin. Afterwards the colors of the points inside the
         * 	produced figure are returned as binary data.
         */
        val Some( result ) = routeAndCall( FakeRequest( GET, "/binary/data/cube?px=0&py=0&pz=0&ax=0&ay=1&az=0" ) )
        status( result ) must be equalTo ( OK )
        contentType( result ) must equalTo( Some( "application/octet-stream" ) )
        contentAsBytes( result ).foldLeft( 0 )( ( b, x ) => b + x ) must be equalTo 0
      }
    }
    "return null block for negative parameters" in {
      running( FakeApplication() ) {
        val Some( result ) = routeAndCall( FakeRequest( GET, "/binary/data/cube?px=173&py=-26&pz=198&ax=-0.9&ay=0.2&az=-0.3" ) )
        status( result ) must be equalTo ( OK )
        contentType( result ) must equalTo( Some( "application/octet-stream" ) )
        contentAsBytes( result ).foldLeft( 0 )( ( b, x ) => b + x ) must be equalTo 0
      }
    }
  }
}
