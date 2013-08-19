package integration

import org.specs2.mutable._
import play.api.test._
import play.api.test.Helpers._
import play.api.libs.json._
import play.api.libs.json.Json._
import scala.util.Random
import play.api.mvc._
import play.api.mvc.AnyContent
import braingames.util.ExtendedTypes._
import controllers.BinaryData
import models.DataSet
import util.ExtendedFakeRequest._

object BinaryTest extends Specification {
  sequential

  "Binary REST interface" should {
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
        val Some( resultAsyc ) = routeAndCall( FakeRequest(
          POST,
          "/binary/ajax?&dataSetId=" + dataId + "&cubeSize=64",
          FakeHeaders( Map( "Content" -> List( "application/octet-stream" ) ) ),
          RawBuffer( memoryThreshold = 1024, matrix.flatMap( _.toBinary.reverse ) ) ).authenticated() )

        ( resultAsyc.asInstanceOf[AsyncResult] ).result.map( result => {
          status( result ) must be equalTo ( OK )
          contentType( result ) must equalTo( Some( "application/octet-stream" ) )
          contentAsBytes( result ).size must be equalTo 262144
        } ).value.get
      }
    }

    "return data through WebSocket" in {
      running( FakeApplication() ) {
        ko
      }
    }.pendingUntilFixed( "Testing websockets isn't implemented in play till now" )

    "return null block for negative parameters" in {
      running( FakeApplication() ) {
        val dataId = DataSet.default.id
        val matrix = Array[Float]( 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, -1, -1, -1, 1 )
        val Some( resultAsyc ) = routeAndCall( FakeRequest(
          POST,
          "/binary/ajax?&dataSetId=" + dataId + "&cubeSize=64",
          FakeHeaders( Map( "Content" -> List( "application/octet-stream" ) ) ),
          RawBuffer( memoryThreshold = 1024, matrix.flatMap( _.toBinary.reverse ) ) ).authenticated() )

        ( resultAsyc.asInstanceOf[AsyncResult] ).result.map( result => {
          status( result ) must be equalTo ( OK )
          contentType( result ) must equalTo( Some( "application/octet-stream" ) )
          ((_:Byte) must be equalTo 0).forall(contentAsBytes( result ).toTraversable)
        } ).value.get
      }
    }
  }
}
