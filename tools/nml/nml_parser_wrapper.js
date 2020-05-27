const program = require("commander");
const fs = require("fs");

const { parseNml, serializeProtoTracing } = require("../../public/server-bundle/main");

const vector3ToPoint3 = ([x, y, z]) => ({ x, y, z });

const nodeToServerNode = ({ timestamp, position, rotation, ...rest }) => ({
  createdTimestamp: timestamp,
  position: vector3ToPoint3(position),
  rotation: vector3ToPoint3(rotation),
  ...rest,
});

const branchPointToServerBranchPoint = ({ nodeId, timestamp }) => ({
  nodeId,
  createdTimestamp: timestamp,
});

const treesToServerTracing = (trees, treeGroups) => {
  const serverTrees = Object.values(trees).map(
    ({ edges, nodes, timestamp, color, branchPoints, ...rest }) => ({
      createdTimestamp: timestamp,
      branchPoints: branchPoints.map(branchPointToServerBranchPoint),
      color: { r: color[0], g: color[1], b: color[2], a: 1 },
      nodes: nodes.map(nodeToServerNode),
      edges: edges.asArray(),
      ...rest,
    }),
  );

  return {
    dataSetName: "",
    trees: serverTrees,
    createdTimestamp: 0,
    boundingBox: undefined,
    activeNodeId: undefined,
    editPosition: { x: 0, y: 0, z: 0 },
    editRotation: { x: 0, y: 0, z: 0 },
    zoomLevel: 1,
    version: 0,
    userBoundingBox: undefined,
    treeGroups,
  };
};

async function parseFile(err, fileContent) {
  if (err) throw err;
  console.log(`\nFile Content:\n${fileContent}`);

  const parsedNml = await parseNml(fileContent);
  console.log(`\nParsed NML:\n${JSON.stringify(parsedNml)}`);

  const serverTracing = treesToServerTracing(parsedNml.trees, parsedNml.treeGroups);
  console.log(`\nServer Tracing:\n${JSON.stringify(serverTracing)}`);

  const protoTracing = serializeProtoTracing(serverTracing);
  console.log(`\nProto Tracing:\n${JSON.stringify(protoTracing)}`);
}

let nmlPath;
program
  .version("0.1.0", "-v, --version")
  .arguments("<parameter1>")
  .action(function(parameter1) {
    nmlPath = parameter1;
  });

if (process.argv.length !== 3) {
  // 2 "real" parameters
  console.log("Usage: $0 <nmlPath>");
  console.log("Example:");
  console.log("  node ", process.argv[1], " path/to/skeleton.nml");
  process.exit(1);
}

try {
  program.parse(process.argv);

  fs.readFile(nmlPath, "utf8", parseFile);

  console.log("Hello from NML Parser Node Script. Was called with nmlPath", nmlPath);
} catch (err) {
  console.log(err);
  exitCode = 2;
}
