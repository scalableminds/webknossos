package backend

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import net.liftweb.common.{Box, Empty, Failure, Full}
import org.scalatest.flatspec.AsyncFlatSpec

import scala.concurrent.Future
import scala.util.Try

class FoxTestSuite extends AsyncFlatSpec with FoxImplicits {

  "Fox" should "contain exception from failed Future" in {
    val exception = new Exception("boom!")
    val f: Future[Unit] = Future.failed(exception)
    Fox.fromFuture(f).futureBox.map {
      case Failure(msg, e, _) => assert(msg == "java.lang.Exception: boom!", e.contains(exception))
      case _                  => fail()
    }
  }

  it should "contain value from successful Future" in {
    val f: Future[Int] = Future.successful(5)
    Fox.fromFuture(f).futureBox.map {
      case Full(value) => assert(value == 5)
      case _           => fail()
    }
  }

  it should "contain value from Box" in {
    val b: Box[Int] = Full(5)
    b.toFox.futureBox.map {
      case Full(value) => assert(value == 5)
      case _           => fail()
    }
  }

  it should "contain failure from Box" in {
    val b: Box[Int] = Failure("boom!", Empty, Empty)
    b.toFox.futureBox.map {
      case f: Failure => assert(f.msg == "boom!")
      case _          => fail()
    }
  }

  it should "contain empty from Box" in {
    val b: Box[Int] = Empty
    b.toFox.futureBox.map {
      case Empty => succeed
      case _     => fail()
    }
  }

  it should "contain error from failed Try" in {
    val exception = new Exception("boom!")
    val t: Try[Int] = scala.util.Failure(exception)
    t.toFox.futureBox.map {
      case Failure(msg, e, _) => assert(msg == "java.lang.Exception: boom!"); assert(e.contains(exception))
      case _                  => fail()
    }
  }

  it should "contain value from successful Try" in {
    val t: Try[Int] = scala.util.Success(5)
    t.toFox.futureBox.map {
      case Full(value) => assert(value == 5)
      case _           => fail()
    }
  }

  it should "contain value from full Option" in {
    val o = Some(5)
    o.toFox.futureBox.map {
      case Full(value) => assert(value == 5)
      case _           => fail()
    }
  }

  it should "contain empty from empty Option" in {
    val o = None
    o.toFox.futureBox.map {
      case Empty => succeed
      case _     => fail()
    }
  }

}
