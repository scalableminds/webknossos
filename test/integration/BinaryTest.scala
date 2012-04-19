package integration

import org.specs2.mutable._
import play.api.test._
import play.api.test.Helpers._
import brainflight.binary.CubeModel
import play.api.libs.json._
import play.api.libs.json.Json._
import scala.util.Random
import play.api.mvc._
import play.api.mvc.AnyContent
import brainflight.tools.ExtendedTypes._
import controllers.BinaryData
import models.DataSet

object BinaryTest extends Specification {
  sequential

  "Binary REST interface" should {
    "return a models vertices" in {
      running( FakeApplication() ) {
        /**
         * URL:
         * 	GET - /route/model/:modeltype
         * Params:
         *  	- modeltype: String , A valid data source model (e.q. cube)
         * Response-type:
         * 	application/json
         * Response:
         * 	Coordinates of all vertices of the model
         */
        val Some( result ) = routeAndCall( FakeRequest( GET, "/binary/model/cube" ) )
        status( result ) must be equalTo ( OK )
        contentType( result ) must equalTo( Some( "application/json" ) )
        contentAsString( result ) must be equalTo Json.stringify( toJson( CubeModel.vertices.map( _.toVector3I ) ) )
      }
    }
    "return a models polygons" in {
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
      contentAsString( result ) must be equalTo Json.stringify( toJson( CubeModel.polygons ) )
    }

    "return data through GET" in {
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
        val dataId = DataSet.default.id
        val matrix = Array[Float]( 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 685, 611, 648, 1 )
        val Some( result ) = routeAndCall( FakeRequest(
          POST,
          "/binary/ajax?&dataSetId="+dataId+"&cubeSize=64",
          FakeHeaders( Map( "Content" -> List( "application/octet-stream" ) ) ),
          AnyContentAsRaw( raw = RawBuffer( memoryThreshold = 1024, matrix.flatMap( _.toBinary.reverse ) ) ) ) )

        status( result ) must be equalTo ( OK )
        contentType( result ) must equalTo( Some( "application/octet-stream" ) )
        contentAsBytes( result ).size must be equalTo 302379
      }
    }

    "return data through WebSocket" in {
      running( FakeApplication() ) {
        ko
      }
    }.pendingUntilFixed( "Testing websockets isn't implemented in play till now" )

    "return null block for negative parameters" in {
      running( FakeApplication() ) {
        ko
        //        val Some( result ) = routeAndCall( FakeRequest( GET, "/binary/data/cube?px=173&py=-26&pz=198&ax=-0.9&ay=0.2&az=-0.3" ) )
        //        status( result ) must be equalTo ( OK )
        //        contentType( result ) must equalTo( Some( "application/octet-stream" ) )
        //        contentAsBytes( result ).foldLeft( 0 )( ( b, x ) => b + x ) must be equalTo 0
      }
    }.pendingUntilFixed
  }
}
