package backend

import com.scalableminds.util.box.{Box, Empty, Failure, Full}
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import org.scalatest.wordspec.AsyncWordSpec

import scala.concurrent.Future
import scala.util.Try

class FoxTestSuite extends AsyncWordSpec {

  "Fox" should {
    "contain exception from failed Future" in {
      val exception = new Exception("boom!")
      val f: Future[Unit] = Future.failed(exception)
      Fox.fromFuture(f).futureBox.map {
        case Failure(msg, e, _) => assert(msg == "java.lang.Exception: boom!"); assert(e.toOption.contains(exception))
        case _                  => fail()
      }
    }

    "contain value from successful Future" in {
      val f: Future[Int] = Future.successful(5)
      Fox.fromFuture(f).futureBox.map {
        case Full(value) => assert(value == 5)
        case _           => fail()
      }
    }

    "contain value from Box" in {
      val b: Box[Int] = Full(5)
      b.toFox.futureBox.map {
        case Full(value) => assert(value == 5)
        case _           => fail()
      }
    }

    "contain failure from Box" in {
      val b: Box[Int] = Failure("boom!", Empty, Empty)
      b.toFox.futureBox.map {
        case f: Failure => assert(f.msg == "boom!")
        case _          => fail()
      }
    }

    "contain empty from Box" in {
      val b: Box[Int] = Empty
      b.toFox.futureBox.map {
        case Empty => succeed
        case _     => fail()
      }
    }

    "contain error from failed Try" in {
      val exception = new Exception("boom!")
      val t: Try[Int] = scala.util.Failure(exception)
      t.toFox.futureBox.map {
        case Failure(msg, e, _) => assert(msg == "java.lang.Exception: boom!"); assert(e.toOption.contains(exception))
        case _                  => fail()
      }
    }

    "contain value from successful Try" in {
      val t: Try[Int] = scala.util.Success(5)
      t.toFox.futureBox.map {
        case Full(value) => assert(value == 5)
        case _           => fail()
      }
    }

    "contain value from full Option" in {
      val o = Some(5)
      o.toFox.futureBox.map {
        case Full(value) => assert(value == 5)
        case _           => fail()
      }
    }

    "contain empty from empty Option" in {
      val o = None
      o.toFox.futureBox.map {
        case Empty => succeed
        case _     => fail()
      }
    }

    "run withCleanup's cleanup when the Fox succeeds" in {
      var cleanedUp = false
      val fox = Fox.withCleanup(Fox.successful(5)) { cleanedUp = true }
      fox.futureBox.map { result =>
        assert(cleanedUp)
        assert(result == Full(5))
      }
    }

    "run withCleanup's cleanup when the Fox fails" in {
      var cleanedUp = false
      val fox = Fox.withCleanup(Fox.failure("boom!")) { cleanedUp = true }
      fox.futureBox.map { result =>
        assert(cleanedUp)
        assert(result.isInstanceOf[Failure])
      }
    }

    "run withCleanup's cleanup when a synchronous exception is thrown inside a nested for-comprehension" in {
      var cleanedUp = false
      val fox = Fox.withCleanup {
        for {
          _ <- Fox.successful(())
          _ = throw new Exception("boom!")
        } yield ()
      } { cleanedUp = true }
      // The synchronous throw rejects the underlying Future outright (Box.Full.map does not itself
      // catch exceptions), so normalize before asserting instead of chaining directly off futureBox.
      fox.futureBox.transform(_ => scala.util.Success(())).map { _ =>
        assert(cleanedUp)
      }
    }

    "run withCleanup's cleanup even when constructing the Fox itself throws synchronously" in {
      var cleanedUp = false
      val fox = Fox.withCleanup(throw new Exception("boom!")) { cleanedUp = true }
      fox.futureBox.transform(_ => scala.util.Success(())).map { _ =>
        assert(cleanedUp)
      }
    }
  }

}
