import test from "ava";
import MultiKeyMap from "libs/multi_key_map";

test("MultiKeyMap: basic set/get", (t) => {
  const map = new MultiKeyMap();

  const obj1 = {};
  const obj2 = {};
  const obj3 = {};
  const obj4 = {};

  const key1 = [obj1, obj2, obj3, obj4];
  // The key is another object which has a different identity
  // than key1. However, the used objects are the same
  // which is why the key should behave equivalently.
  const key1Equalivent = [obj1, obj2, obj3, obj4];

  const key2 = [obj2, obj1, obj3, obj4];

  // Set/get with key1 and key1Equalivent
  map.set(key1, "test");
  t.is(map.get(key1), "test");
  t.is(map.get(key1Equalivent), "test");

  // Set/get with key2
  map.set(key2, "test2");
  t.is(map.get(key2), "test2");

  // Set/get with key1 and key1Equalivent
  map.set(key1, "test");
  t.is(map.get(key1), "test");
  t.is(map.get(key1Equalivent), "test");
});

test("MultiKeyMap: get non-existent key", (t) => {
  const map = new MultiKeyMap();

  const obj1 = {};
  const obj2 = {};
  const obj3 = {};
  const obj4 = {};

  const key1 = [obj1, obj2, obj3, obj4];
  t.is(map.get(key1), undefined);
});

test("MultiKeyMap: override", (t) => {
  const map = new MultiKeyMap();

  const obj1 = {};
  const obj2 = {};
  const obj3 = {};
  const obj4 = {};

  const key1 = [obj1, obj2, obj3, obj4];
  const key1Equalivent = [obj1, obj2, obj3, obj4];
  map.set(key1, "test");
  t.is(map.get(key1), "test");
  map.set(key1Equalivent, "test2");
  t.is(map.get(key1), "test2");
});
