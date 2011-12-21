import org.specs2.mutable._
import play.api.mvc._
import play.api.libs.iteratee._
import play.api.libs.concurrent._
import play.api.test._
import play.api.json._
import play.api.test.MockApplication._
import brainflight.binary.CubeModel

class FakeRequest[AnyContent]( url: String ) extends Request[AnyContent] {
  def uri = url
  def method = "GET"
  def queryString = Map.empty()
  def body: AnyContent = AnyContentAsUrlFormEncoded( Map( "foo" -> Seq( "value" ) ) ).asInstanceOf[AnyContent]

  def username = Some( "peter" )
  def path = "/"

  def headers = new Headers {
    def getAll( key: String ) = Seq( "testValue1", "testValue2" )
    def keys = Set.empty
  }
  def cookies = new Cookies {
    def get( name: String ) = Some( Cookie( name = "foo", value = "yay" ) )
  }
}

object BinaryTest extends Specification {
  sequential

  "Binary REST interface" should {
    "return model" in {
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
      withApplication( Nil, MockData.dataSource ) {
        val action = controllers.BinaryData.model( "cube" )
        val result = action.apply( new FakeRequest( "/route/model/cube" ) )
        val extracted = Extract.from( result )
        extracted._1.toString must be equalTo( "200" )
        extracted._2.toString must be equalTo( "Map(Content-Type -> application/octet-stream)" )
        extracted._3 must be equalTo CubeModel.modelInformation.toString
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
      withApplication( Nil, MockData.dataSource ) {
        val action = controllers.BinaryData.polygons( "cube" )
        val result = action.apply( new FakeRequest( "/route/polygons/cube" ) )
        val extracted = Extract.from( result )
        extracted._1.toString must be equalTo( "200" )
        extracted._2.toString must be equalTo( "Map(Content-Type -> application/json; charset=utf-8)" )
        extracted._3 must be equalTo toJson( CubeModel.polygons ).toString
      }
    }
    "return data" in {
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
      withApplication( Nil, MockData.dataSource ) {
        val action = controllers.BinaryData.data( "cube", 0, 0, 0, 0, 1, 0 )
        val result = action.apply( new FakeRequest( "/route/data/cube?px=0&py=0&pz=0&ax=0&ay=0&az=0" ) )
        val extracted = Extract.from( result )
        extracted._1.toString must be equalTo( "200" )
        extracted._2.toString must be equalTo( "Map(Content-Type -> application/octet-stream)" )
        extracted._3 must not be empty
      }
    }
  }
}
