package brainflight

import org.specs2.mutable._
import play.api.test._
import play.api.test.Helpers._
import com.mongodb.casbah.Imports._
import com.mongodb.casbah.gridfs.Imports._
import java.io._
import brainflight.binary.{ FileDataStore, GridFileDataStore }
import java.security.MessageDigest

class GridFSTest extends Specification {
  sequential

  val mongo = MongoConnection()("gridfs-test")
  mongo.dropDatabase()
  val gridfs = GridFS(mongo)
  val x = 5
  val y = 6
  val z = 7

  def testFile = new FileInputStream(GridFileDataStore.createFilename(x, y, z))

  def testFileBytes = {
    val bytes = new Array[Byte](testFile.available)
    testFile.read(bytes)
    bytes
  }

  "GridFS" should {
    "insert file and contain just 1 file" in {
      running(FakeApplication()) {
        gridfs(testFile) { file =>
          file.filename = GridFileDataStore.convertCoordinatesToString(x, y, z)
          file.contentType = "application"
        }
      }
      gridfs.size must be equalTo 1
    }

    "find the inserted file" in {
      running(FakeApplication()){
        val retrievedFile = gridfs.findOne(GridFileDataStore.convertCoordinatesToString(x, y, z))
        //calc digest of original file
        val digest = MessageDigest.getInstance("MD5")
        digest.update(testFileBytes)
        val testFile_md5 = digest.digest().map("%02X".format(_)).mkString.toLowerCase()
        
        retrievedFile must beSome
        retrievedFile.get must beAnInstanceOf[GridFSDBFile]
        retrievedFile.get.md5 must be equalTo testFile_md5
      }
    }

    "load the same bytes as the FileStore" in {
      running(FakeApplication()) {
        //assuming differences in every byte
        var differences = 2097152
        val blockX = 5
        val blockY = 6
        val blockZ = 7
        for {
          x <- blockX * 128 until (blockX + 1) * 128
          y <- blockY * 128 until (blockY + 1) * 128
          z <- blockZ * 256 until (blockZ + 1) * 256 by 2
        } {
          val FileStoreByte = FileDataStore.load((x, y, z))
          val GridFileStoreByte = GridFileDataStore.load((x, y, z))

          if (FileStoreByte == GridFileStoreByte)
            differences -= 1
        }
        differences must be equalTo 0
        GridFileDataStore.fileCache.size must be equalTo 1
      }
    }
  }
}