import test from "ava";

interface ServerNode {
  id: string;
  name: string;
  status: string;
}

interface MutableNode {
  id: string;
  value: any;
  updatedAt: Date;
}

test("ServerNode has the right fields", (t) => {
  const serverNode: ServerNode = {
    id: "1",
    name: "Server1",
    status: "active",
  };

  t.is(serverNode.id, "1");
  t.is(serverNode.name, "Server1");
  t.is(serverNode.status, "active");
});

test("MutableNode has the right fields", (t) => {
  const mutableNode: MutableNode = {
    id: "2",
    value: "some value",
    updatedAt: new Date(),
  };

  t.is(mutableNode.id, "2");
  t.is(mutableNode.value, "some value");
  t.true(mutableNode.updatedAt instanceof Date);
});
