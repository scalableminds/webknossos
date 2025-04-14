package backend

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import net.liftweb.common.{Box, Empty, Failure, Full}
import org.scalatest.flatspec.AsyncFlatSpec

import scala.concurrent.Future

class FoxTestSuite extends AsyncFlatSpec with FoxImplicits {

  "Fox" should "contain error from future" in {
    val f: Future[Unit] = Future.failed(new Exception("boom!"))
    Fox.fromFuture(f).futureBox.map {
      case f: Failure => assert(f.msg == "boom!")
      case _          => fail()
    }
  }

  it should "contain value from future" in {
    val f: Future[Int] = Future.successful(5)
    Fox.fromFuture(f).futureBox.map {
      case Full(value) => assert(value == 5)
      case _           => fail()
    }
  }

  it should "contain value from box" in {
    val b: Box[Int] = Full(5)
    b.toFox.futureBox.map {
      case Full(value) => assert(value == 5)
      case _           => fail()
    }
  }

  it should "contain failure from box" in {
    val b: Box[Int] = Failure("boom!", Empty, Empty)
    b.toFox.futureBox.map {
      case f: Failure => assert(f.msg == "boom!")
      case _          => fail()
    }
  }

  it should "contain empty from box" in {
    val b: Box[Int] = Empty
    b.toFox.futureBox.map {
      case Empty => succeed
      case _     => fail()
    }
  }

}
