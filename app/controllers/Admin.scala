package controllers

import play.api._
import play.api.mvc._
import play.api.data._
import play.api.Play.current
import play.mvc.Results.Redirect
import play.Logger
import java.text.SimpleDateFormat
import java.util.TimeZone
import brainflight.binary.{FileDataStore,GridFileDataStore}
import java.io.{ FileNotFoundException, InputStream, FileInputStream, File }
import com.mongodb.casbah.Imports._
import com.mongodb.casbah.gridfs.Imports._

object Admin extends Controller{
  
  def testGridFS = Action{
    //Iterate over Block 5/10/10
    var differences = 0
    /*for{x <- 5*128 until 6*128
    	y <- 10*128 until 11*128
    	z <- 10*256 until 11*256 by 2}{
    	  val FileStoreByte = FileDataStore.load((x,y,z))
    	  val GridFileStoreByte = GridFileDataStore.load((x,y,z))
    	  
    	  if(FileStoreByte != GridFileStoreByte)
    	    differences += 1
    }
    Logger.info("%d items in FileDataStore.".format(FileDataStore.fileCache.size))
    Logger.info("%d items in GridFileDataStore.".format(GridFileDataStore.fileCache.size))*/
    GridFileDataStore.BinDatabase.findOne("000500100011") match { 
      case Some(file) =>
      	Logger.info("%d".format(file.chunkSize))
      	val is = GridFileDataStore.inputStreamToByteArray(file.inputStream)
      	for(i <- 0 to 10) Logger.info("%d".format(is(i)))
      case _ => Logger.info("file not found")
    }
    
    /*match {
      case Some(data) => 
        val is = GridFileDataStore.inputStreamToByteArray(data.inputStream)
        for(i <- 0 to 10) Logger.info("%d".format(is(i)))
        //val byteArray = new Array[Byte](2097152)
        //val bytesRead = data.source.reader.read(byteArray, 0, 2097152)
        //Logger.info("%d bytes".format(data.source.length))
      case None => Logger.info("item not found")
    }*/
    Ok("done with %d differences".format(differences))
  }
}

