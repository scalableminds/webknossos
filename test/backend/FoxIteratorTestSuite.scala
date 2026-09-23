package backend

import com.scalableminds.util.box.{Failure, Full}
import com.scalableminds.util.tools.{Fox, FoxIterator, SyncFoxIterator}
import org.scalatest.wordspec.AsyncWordSpec

import scala.collection.mutable
import scala.collection.mutable.ListBuffer
import scala.concurrent.ExecutionContext

class FoxIteratorTestSuite extends AsyncWordSpec {

  implicit private val ec: ExecutionContext = scala.concurrent.ExecutionContext.global

  // Yields the given values in order, then fails forever instead of exhausting via Fox.empty.
  // Lets tests assert that a failure encountered mid-iteration is propagated rather than swallowed.
  private def failingAfter[A](values: List[A]): FoxIterator[A] = new FoxIterator[A] {
    private val remaining = mutable.Queue.from(values)
    override def next(): Fox[A] =
      if (remaining.nonEmpty) Fox.successful(remaining.dequeue())
      else Fox.failure("boom!")
  }

  private def collect[A](it: FoxIterator[A]): Fox[List[A]] = {
    val buffer = ListBuffer[A]()
    it.foreach(buffer += _).map(_ => buffer.toList)
  }

  // Yields the given values in order, tracking how many have been pulled so far.
  private def countingIterator[A](values: List[A]): (FoxIterator[A], () => Int) = {
    var count = 0
    val remaining = mutable.Queue.from(values)
    val it = new FoxIterator[A] {
      override def next(): Fox[A] =
        if (remaining.nonEmpty) {
          count += 1
          Fox.successful(remaining.dequeue())
        } else Fox.empty
    }
    (it, () => count)
  }

  "SyncFoxIterator" should {
    "yield each element of the underlying iterator in order, then be exhausted" in {
      val it = new SyncFoxIterator(List(1, 2, 3).iterator)
      collect(it).futureBox.map(result => assert(result == Full(List(1, 2, 3))))
    }

    "be immediately exhausted for an empty underlying iterator" in {
      val it = new SyncFoxIterator(Iterator.empty[Int])
      collect(it).futureBox.map(result => assert(result == Full(List.empty)))
    }
  }

  "FoxIterator.map" should {
    "transform every element" in {
      val it = new SyncFoxIterator(List(1, 2, 3).iterator).map(_ * 10)
      collect(it).futureBox.map(result => assert(result == Full(List(10, 20, 30))))
    }

    "propagate a failure from the underlying iterator after yielding the earlier elements" in {
      val it = failingAfter(List(1, 2)).map(_ * 10)
      collect(it).futureBox.map { result =>
        assert(result.isInstanceOf[Failure])
      }
    }
  }

  "FoxIterator.flatMap" should {
    "keep elements mapped to Some and skip elements mapped to None" in {
      val it = new SyncFoxIterator(List(1, 2, 3, 4).iterator).flatMap(x => if (x % 2 == 0) Some(x) else None)
      collect(it).futureBox.map(result => assert(result == Full(List(2, 4))))
    }

    "propagate a failure from the underlying iterator" in {
      val it = failingAfter(List(1, 2)).flatMap(x => Some(x))
      collect(it).futureBox.map { result =>
        assert(result.isInstanceOf[Failure])
      }
    }
  }

  "FoxIterator.concat" should {
    "yield all elements of the first iterator, then all of the second" in {
      val it = new SyncFoxIterator(List(1, 2).iterator).concat(new SyncFoxIterator(List(3, 4).iterator))
      collect(it).futureBox.map(result => assert(result == Full(List(1, 2, 3, 4))))
    }

    "fall through directly to the second iterator when the first is already empty" in {
      val it = new SyncFoxIterator(Iterator.empty[Int]).concat(new SyncFoxIterator(List(1, 2).iterator))
      collect(it).futureBox.map(result => assert(result == Full(List(1, 2))))
    }

    "propagate a failure from the first iterator without pulling from the second" in {
      val it = failingAfter(List(1)).concat(new SyncFoxIterator(List(99).iterator))
      val buffer = ListBuffer[Int]()
      it.foreach(buffer += _).futureBox.map { result =>
        assert(result.isInstanceOf[Failure])
        assert(buffer.toList == List(1))
      }
    }
  }

  "FoxIterator.foreach" should {
    "run the function on every element in order and succeed once exhausted" in {
      val buffer = ListBuffer[Int]()
      new SyncFoxIterator(List(1, 2, 3).iterator).foreach(buffer += _).futureBox.map { result =>
        assert(result == Full(()))
        assert(buffer.toList == List(1, 2, 3))
      }
    }

    "propagate a failure encountered while pulling elements, having processed the earlier ones" in {
      val buffer = ListBuffer[Int]()
      failingAfter(List(1, 2, 3)).foreach(buffer += _).futureBox.map { result =>
        assert(result.isInstanceOf[Failure])
        assert(buffer.toList == List(1, 2, 3))
      }
    }
  }

  "Fox.serialCombined on a FoxIterator" should {
    "run f on every element in order and collect the results" in
      Fox
        .serialCombined(new SyncFoxIterator(List(1, 2, 3).iterator))(x => Fox.successful(x * 10))
        .futureBox
        .map(result => assert(result == Full(List(10, 20, 30))))

    "propagate a failure encountered while pulling elements" in
      Fox.serialCombined(failingAfter(List(1, 2)))(x => Fox.successful(x)).futureBox.map { result =>
        assert(result.isInstanceOf[Failure])
      }

    "propagate a failure returned by f itself and stop pulling further elements" in {
      val (it, pulledCount) = countingIterator(List(1, 2, 3))
      Fox.serialCombined(it)(x => if (x == 2) Fox.failure("boom!") else Fox.successful(x)).futureBox.map { result =>
        assert(result.isInstanceOf[Failure])
        assert(pulledCount() == 2)
      }
    }
  }

}
