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

object Admin extends Controller{
  
  def testGridFS = Action{
    //Iterate over Block 5/10/10
    var differences = 0
    for{x <- 5*128 until 6*128
    	y <- 10*128 until 11*128
    	z <- 10*256 until 11*256 by 2}{
    	  val FileStoreByte = FileDataStore.load((x,y,z))
    	  val GridFileStoreByte = GridFileDataStore.load((x,y,z))
    	  
    	  if( FileStoreByte != GridFileStoreByte)
    	    differences += 1
    }
    Logger.info("%d items in FileDataStore.".format(FileDataStore.fileCache.size))
    Logger.info("%d items in GridFileDataStore.".format(GridFileDataStore.fileCache.size))
    Ok("done with %d differences".format(differences))
  }
}

