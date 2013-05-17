package brainflight

import org.specs2.mutable._
import play.api.test._
import play.api.test.Helpers._
import com.mongodb.casbah.Imports._
import com.mongodb.casbah.gridfs.Imports._
import java.io._
import play.Logger
import oxalis.binary.{ FileDataStore }
import oxalis.binary.GridFileDataStore
import java.security.MessageDigest
import braingames.util.ExtendedTypes._
import braingames.geometry.Point3D
import models.DataSet

class GridFSTest extends Specification {
  sequential

  val mongo = MongoConnection()( "binaryData" )
  val gridfs = GridFS( mongo )
  val point = Point3D( 5, 6, 7 )
  val numberOfBinFiles = 68311
  val filesize = 2097152
  val gfds = new GridFileDataStore

  def testFile = new FileInputStream( gfds.createFilename( DataSet.default, 1, point ) )

  def testFileBytes = {
    val bytes = new Array[Byte]( testFile.available )
    testFile.read( bytes )
    bytes
  }

  "GridFS" should {
    "insert file and contain just 1 file" in {
      gridfs.size must be equalTo numberOfBinFiles
    }.pendingUntilFixed

    "find the testfile" in {
      running( FakeApplication() ) {
        val retrievedFile = gridfs.findOne( gfds.convertCoordinatesToString( point ) )
        retrievedFile must beSome
        retrievedFile foreach { file =>
          file must beAnInstanceOf[GridFSDBFile]
          file.sourceWithCodec( scala.io.Codec.ISO8859 ).size must be equalTo filesize
        }

        //calc digest of original file
        val digest = MessageDigest.getInstance( "MD5" )
        digest.update( testFileBytes )
        val testFile_md5 = digest.digest().map( "%02X".format( _ ) ).mkString.toLowerCase()
        retrievedFile.get.md5 must be equalTo testFile_md5
      }
    }.pendingUntilFixed

    "load the same bytes as the FileStore" in {
      running( FakeApplication() ) {
        //assuming differences in every byte
        var differences = filesize
        val blockX = point.x
        val blockY = point.y
        val blockZ = point.z
        /*for {
          x <- blockX * 128 until ( blockX + 1 ) * 128
          y <- blockY * 128 until ( blockY + 1 ) * 128
          z <- blockZ * 256 until ( blockZ + 1 ) * 256 by 2
        } {
          val FileStoreByte = FileDataStore.load( DataSet.default, 1 )( Point3D( x, y, z ) )
          val GridFileStoreByte = GridFileDataStore.load( DataSet.default, 1 )( Point3D( x, y, z ) )
          if ( FileStoreByte == FileStoreByte )
            differences -= 1
        }*/
        differences must be equalTo 0
        gfds.fileCache.size must be equalTo 1
        gfds.cleanUp()
        gfds.fileCache.size must be equalTo 0
        
        ko
      }
    }.pendingUntilFixed
  }
}