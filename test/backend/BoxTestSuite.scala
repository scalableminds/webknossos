package backend

import com.scalableminds.util.box.{Box, Empty, Failure, Full, ParamFailure}
import org.scalatest.wordspec.AsyncWordSpec

import scala.util.{Success, Failure as TryFailure}

class BoxTestSuite extends AsyncWordSpec {

  "Full" should {

    "report isDefined and not isEmpty" in {
      val box = Full(42)
      assert(box.isDefined)
      assert(!box.isEmpty)
    }

    "return its value with get" in
      assert(Full("hello").get("test") == "hello")

    "return its value with getOrElse, ignoring the default" in
      assert(Full(1).getOrElse(99) == 1)

    "return itself with orElse" in
      assert(Full(1).orElse(Full(2)) == Full(1))

    "map over its value" in
      assert(Full(3).map(_ * 2) == Full(6))

    "flatMap to a Full when the function returns Full" in
      assert(Full(3).flatMap(x => Full(x + 1)) == Full(4))

    "flatMap to Empty when the function returns Empty" in
      assert(Full(3).flatMap(_ => Empty) == Empty)

    "filter: retain value when predicate holds" in
      assert(Full(4).filter(_ % 2 == 0) == Full(4))

    "filter: become Empty when predicate fails" in
      assert(Full(3).filter(_ % 2 == 0) == Empty)

    "filterNot: become Empty when predicate holds" in
      assert(Full(4).filterNot(_ % 2 == 0) == Empty)

    "filterNot: retain value when predicate fails" in
      assert(Full(3).filterNot(_ % 2 == 0) == Full(3))

    "return true from exists when predicate holds" in
      assert(Full(5).exists(_ > 3))

    "return false from exists when predicate fails" in
      assert(!Full(5).exists(_ > 10))

    "return true from contains for the held value" in
      assert(Full("x").contains("x"))

    "return false from contains for a different value" in
      assert(!Full("x").contains("y"))

    "return true from forall when predicate holds" in
      assert(Full(10).forall(_ > 0))

    "return false from forall when predicate fails" in
      assert(!Full(10).forall(_ > 100))

    "execute foreach with the contained value" in {
      var seen = -1
      Full(7).foreach(v => seen = v)
      assert(seen == 7)
    }

    "convert to Some via toOption" in
      assert(Full("a").toOption.contains("a"))

    "convert to a single-element list via toList" in
      assert(Full(42).toList == List(42))

    "convert to a single-element iterator via iterator" in
      assert(Full(42).iterator.toList == List(42))

    "pass through ?~> unchanged" in {
      val box: Box[Int] = Full(1)
      assert((box ?~> "err") == Full(1))
    }

    "pass through ~> unchanged" in {
      val box: Box[Int] = Full(1)
      assert((box ~> 404) == Full(1))
    }

    "pass through ?-> unchanged" in {
      val box: Box[Int] = Full(1)
      assert((box ?-> "err") == Full(1))
    }

    "pass through ??~> unchanged" in {
      val box: Box[Int] = Full(1)
      assert((box ??~> "err") == Full(1))
    }

    "be equal to another Full wrapping the same value" in
      assert(Full(42) == Full(42))

    "not be equal to a Full wrapping a different value" in
      assert(Full(42) != Full(43))

    "not be equal to its unwrapped value" in
      assert(!Full(42).equals(42))

  }

  "Empty" should {

    "report isEmpty and not isDefined" in {
      assert(Empty.isEmpty)
      assert(!Empty.isDefined)
    }

    "throw NullPointerException when get is called" in
      assertThrows[NullPointerException](Empty.get("reason"))

    "return the default from getOrElse" in
      assert(Empty.getOrElse("default") == "default")

    "return the alternative box from orElse" in
      assert(Empty.orElse(Full(5)) == Full(5))

    "return Empty from map" in
      assert(Empty.map((_: Nothing) => 1) == Empty)

    "return Empty from flatMap" in
      assert(Empty.flatMap((_: Nothing) => Full(1)) == Empty)

    "return itself from filter" in
      assert(Empty.filter((_: Nothing) => true) == Empty)

    "return false from exists" in
      assert(!Empty.exists((_: Nothing) => true))

    "return false from contains" in
      assert(!Empty.contains("anything"))

    "return true from forall (even if the predicate returns false)" in
      assert(Empty.forall((_: Nothing) => false))

    "not execute foreach" in {
      var called = false
      Empty.foreach((_: Nothing) => called = true)
      assert(!called)
    }

    "return None from toOption" in
      assert(Empty.toOption.isEmpty)

    "return empty list from toList" in
      assert(Empty.toList == List.empty)

    "return an empty iterator" in
      assert(!Empty.iterator.hasNext)

    "become a Failure with a message via ?~>" in {
      val result = Empty ?~> "something went wrong"
      assert(result == Failure("something went wrong", Empty, Empty))
    }

    "become a ParamFailure[Int] with an error code via ~>" in {
      val result = Empty ~> 404
      result match {
        case ParamFailure(_, _, _, code) => assert(code == 404)
        case _                           => fail("expected ParamFailure")
      }
    }

    "become a Failure (overwriting message) via ??~>" in {
      val result = Empty ??~> "overwritten"
      assert(result == Failure("overwritten", Empty, Empty))
    }

    "pass through ?-> unchanged (Empty stays Empty)" in {
      val result: Box[Nothing] = Empty ?-> "ignored"
      assert(result == Empty)
    }

  }

  "Failure" should {

    "report isEmpty and not isDefined" in {
      val f = Failure("oops")
      assert(f.isEmpty)
      assert(!f.isDefined)
    }

    "throw NullPointerException when get is called" in
      assertThrows[NullPointerException](Failure("oops").get("reason"))

    "store a message" in
      assert(Failure("something broke").msg == "something broke")

    "store an exception" in {
      val ex = new RuntimeException("boom")
      val f = Failure("boom", Full(ex), Empty)
      assert(f.exception == Full(ex))
    }

    "return the default from getOrElse" in
      assert(Failure("err").getOrElse(99) == 99)

    "return the alternative box from orElse" in
      assert(Failure("err").orElse(Full(1)) == Full(1))

    "pass through map unchanged" in {
      val f = Failure("err")
      assert(f.map((_: Nothing) => 1) == f)
    }

    "pass through flatMap unchanged" in {
      val f = Failure("err")
      assert(f.flatMap((_: Nothing) => Full(1)) == f)
    }

    "chain with a new Failure wrapping the old one via ?~>" in {
      val inner = Failure("inner")
      val outer = inner ?~> "outer"
      assert(outer == Failure("outer", Empty, Full(inner)))
    }

    "add an HTTP error code while preserving the message via ~>" in {
      val f = Failure("not found")
      val pf = f ~> 404
      pf match {
        case ParamFailure(msg, _, _, code) =>
          assert(msg == "not found")
          assert(code == 404)
        case _ => fail("expected ParamFailure")
      }
    }

    "chain Failures with ?-> (same as ?~> for Failure)" in {
      val inner = Failure("inner")
      val outer = inner ?-> "outer"
      assert(outer == Failure("outer", Empty, Full(inner)))
    }

    "overwrite its message via ??~>" in {
      val f = Failure("original")
      val result = f ??~> "replacement"
      assert(result == Failure("replacement", Empty, Empty))
    }

    "be equal to another Failure with the same fields" in
      assert(Failure("x", Empty, Empty) == Failure("x", Empty, Empty))

    "not be equal to a Failure with a different message" in
      assert(Failure("a") != Failure("b"))

  }

  "ParamFailure" should {

    "store a typed parameter" in {
      val pf = ParamFailure("err", 42)
      assert(pf.param == 42)
      assert(pf.msg == "err")
    }

    "report isEmpty" in
      assert(ParamFailure("err", 0).isEmpty)

    "be extractable via unapply pattern match" in {
      val box: Box[Nothing] = ParamFailure("oops", Full(new RuntimeException("ex")), Empty, "detail")
      box match {
        case ParamFailure(msg, _, _, param) =>
          assert(msg == "oops")
          assert(param == "detail")
        case _ => fail("expected ParamFailure")
      }
    }

    "not be extracted from a plain Failure via unapply" in {
      val box: Box[Nothing] = Failure("plain")
      assert(ParamFailure.unapply(box).isEmpty)
    }

    "not be equal to a plain Failure with the same msg/exception/chain (symmetrically)" in {
      val failure = Failure("err", Empty, Empty)
      val paramFailure = ParamFailure("err", Empty, Empty, 1)
      assert(!paramFailure.equals(failure))
      assert(!failure.equals(paramFailure))
    }

    "preserve the param when chaining with ?~>" in {
      val pf = ParamFailure("original", "my-param")
      val chained = pf ?~> "chained"
      chained match {
        case ParamFailure(msg, _, chain, param) =>
          assert(msg == "chained")
          assert(param == "my-param")
          assert(chain == Full(pf))
        case _ => fail("expected ParamFailure")
      }
    }

    "wrap itself in chain when ~> adds an error code" in {
      val pf = ParamFailure("err", "some-data")
      val withCode = pf ~> 500
      withCode match {
        case ParamFailure(msg, _, chain, code) =>
          assert(msg == "err")
          assert(code == 500)
          assert(chain == Full(pf))
        case _ => fail("expected ParamFailure")
      }
    }

  }

  "Box.combined" should {

    "combine a sequence of Full values into a Full of Seq" in {
      val result = Box.combined(List(1, 2, 3))(x => Full(x * 10))
      assert(result == Full(Seq(10, 20, 30)))
    }

    "return the first failure when any element fails" in {
      val result = Box.combined(List(1, 2, 3)) { x =>
        if (x >= 2) Failure(s"bad element $x") else Full(x)
      }
      assert(result == Failure("bad element 2"))
    }

    "return the first non-Full box, even when it is Empty" in {
      val result = Box.combined(List(1, 2, 3)) { x =>
        if (x == 2) Empty else if (x == 3) Failure("bad element 3") else Full(x)
      }
      assert(result == Empty)
    }

    "return a Full of empty Seq for an empty input sequence" in
      assert(Box.combined(List.empty[Int])(Full(_)) == Full(Seq.empty))

  }

  "Box.combined (Seq[Box] variant)" should {

    "combine a sequence of Full boxes into a Full of Seq" in {
      val result = Box.combined(Seq(Full(1), Full(2), Full(3)))
      assert(result == Full(Seq(1, 2, 3)))
    }

    "return the first failure when any box is a Failure" in {
      val result = Box.combined(Seq(Full(1), Failure("first"), Failure("second")))
      assert(result == Failure("first"))
    }

    "return the first non-Full box, even when it is Empty" in {
      val result: Box[Seq[Int]] = Box.combined(Seq[Box[Int]](Full(1), Empty, Failure("later")))
      assert(result == Empty)
    }

    "return a Full of empty Seq for an empty input sequence" in
      assert(Box.combined(Seq.empty[Box[Int]]) == Full(Seq.empty))

  }

  "Box.fromOption" should {

    "return Full for Some" in
      assert(Box.fromOption(Some(7)) == Full(7))

    "return Empty for None" in
      assert(Box.fromOption(None) == Empty)

  }

  "Box.fromTry" should {

    "return Full for a successful Try" in
      assert(Box.fromTry(Success(42)) == Full(42))

    "return Failure for a failed Try" in {
      val ex = new IllegalArgumentException("bad input")
      val result = Box.fromTry(TryFailure(ex))
      result match {
        case Failure(msg, Full(e), Empty) =>
          assert(msg == "bad input")
          assert(e eq ex)
        case _ => fail("expected Failure")
      }
    }

  }

  "Box.fromBool" should {

    "return Full(()) for true" in
      assert(Box.fromBool(true) == Full(()))

    "return Empty for false" in
      assert(Box.fromBool(false) == Empty)

  }

  "Box.tryo" should {

    "return Full when the block succeeds" in
      assert(Box.tryo(42) == Full(42))

    "return Failure when the block throws" in {
      val result = Box.tryo(throw new RuntimeException("tryo boom"))
      result match {
        case Failure(msg, Full(_), Empty) => assert(msg == "tryo boom")
        case _                            => fail("expected Failure")
      }
    }

    "return Empty when the thrown exception class is in the ignore list" in {
      val result = Box.tryo(List(classOf[IllegalArgumentException]))(throw new IllegalArgumentException("ignored"))
      assert(result == Empty)
    }

    "still return Failure when a non-ignored exception class is thrown" in {
      val result = Box.tryo(List(classOf[IllegalArgumentException]))(throw new RuntimeException("not ignored"))
      assert(result.isInstanceOf[Failure])
    }

    "invoke the onError callback before returning a Failure" in {
      var captured: Throwable = null
      val ex = new RuntimeException("callback test")
      Box.tryo((t: Throwable) => captured = t)(throw ex)
      assert(captured eq ex)
    }

  }

}
