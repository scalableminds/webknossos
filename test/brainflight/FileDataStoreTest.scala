package brainflight

import org.specs2.mutable.Specification
import play.api.test._
import play.api.test.Helpers._
import brainflight.binary.DataStore
import java.io.FileNotFoundException
import brainflight.binary.FileDataStore

class FileDataStoreTest extends Specification {
  sequential
  "DataStore" should {
    "load Data" in {
      running(FakeApplication()) {
        try {
          // if this failes the data has changed
          FileDataStore.load((0, 0, 0)) must be equalTo (0.toByte)
        } catch {
          case e: FileNotFoundException =>
            ko("Data not found: Put binary data in e.q. binarydata/x0000/y0000/z0000/100527_k0563_mag1_x0000_y0000_z0000.raw")
        }
      }
    }
    "not return random data" in {
      running(FakeApplication()) {
        FileDataStore.load((15, 53, 25)) must be equalTo FileDataStore.load((15, 53, 24)) 
      }
    }
    "return black for not existing Data" in {
      running(FakeApplication()) {
        FileDataStore.load((-34, 53, 25)) must be equalTo (0.toByte)
        FileDataStore.load((22222222, 33333333, 4444444)) must be equalTo (0.toByte)
      }
    }
  }
}