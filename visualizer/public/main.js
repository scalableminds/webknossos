let versions = [];
let activeIndex = 0;

const sidebar = document.getElementById("sidebar");
const main = document.getElementById("main");

fetch("/versions")
  .then(res => res.json())
  .then(data => {
    versions = data;
    buildSidebar();
    renderVersion(0);
  });

function buildSidebar() {
  sidebar.innerHTML = "";

  versions.forEach((v, i) => {
    const entry = document.createElement("div");
    entry.textContent = `Version ${v.version}`;
    entry.onclick = () => {
      activeIndex = i;
      renderVersion(i);
      updateActive();
    };
    sidebar.appendChild(entry);
  });

  updateActive();
}

function updateActive() {
  [...sidebar.children].forEach((el, i) => {
    el.classList.toggle("active", i === activeIndex);
  });
}

function parseAdjacencyList(
  json
) {
  const data = JSON.parse(json);

  return new Map(
    data.map(([key, values]) => [
      key,
      new Set(values),
    ])
  );
}


function renderVersion(index) {
  main.innerHTML = "";

  const { versionMap: versionMapJSON, adjacencyList: adjacencyListJSON, storeState } = versions[index];
  const versionMap = new Map(Object.entries(versionMapJSON).map(([k, v]) => [Number.parseInt(k, 10), v]))
  const adjacencyList = parseAdjacencyList(adjacencyListJSON)
  const nodes = [...versionMap.keys()].map(id => ({
    id
  }));

  const links = [];
  for (const [from, tos] of (adjacencyList.entries())) {
    Array.from(tos).forEach(to => {
      links.push({ source: +from, target: to });
    });
  }

  const width = main.clientWidth;
  const height = main.clientHeight;

  const svg = d3
    .select(main)
    .append("svg")
    .attr("viewBox", [0, 0, width, height]);

  const simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id(d => d.id).distance(60))
    .force("charge", d3.forceManyBody().strength(-200))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .stop();

  // run simulation to completion
  simulation.tick(
    Math.ceil(
      Math.log(simulation.alphaMin()) /
      Math.log(1 - simulation.alphaDecay())
    )
  );

  // group nodes by agglomerate id
  const components = d3.group(
    nodes,
    d => versionMap.get(d.id)
  );

  const componentLayer = svg.append("g")
    .attr("fill", "none")
    .attr("stroke", "#666")
    .attr("stroke-dasharray", "4 2");

  const componentLabelLayer = svg.append("g")
    .attr("font-size", 20)
    .attr("font-family", "sans-serif")
    .attr("fill", "#333");

  for (const [aggId, compNodes] of components) {
    const padding = 50;

    const xs = compNodes.map(d => d.x);
    const ys = compNodes.map(d => d.y);

    const minX = Math.min(...xs) - padding;
    const maxX = Math.max(...xs) + padding;
    const minY = Math.min(...ys) - padding;
    const maxY = Math.max(...ys) + padding;

    componentLayer.append("rect")
      .attr("x", minX)
      .attr("y", minY)
      .attr("width", maxX - minX)
      .attr("height", maxY - minY)
      .attr("rx", 12)
      .attr("ry", 12);

    componentLabelLayer.append("text")
      .attr("x", minX + 6)
      .attr("y", minY - 6)
      .text(`Agglomerate ${aggId}`);



  }
  // render links AFTER simulation
  const link = svg.append("g")
    .attr("stroke", "#999")
    .attr("stroke-opacity", 0.6)
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("x1", d => d.source.x)
    .attr("y1", d => d.source.y)
    .attr("x2", d => d.target.x)
    .attr("y2", d => d.target.y);

  // render nodes AFTER simulation
  const nodeGroup = svg.append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .attr("transform", d => `translate(${d.x}, ${d.y})`);

  console.log("storeState.annotation.skeleton", storeState.annotation.skeleton)
  console.log("storeState.annotation.volumes[0].segments", storeState.annotation.volumes[0].segments)
  const segments = new Map(storeState.annotation.volumes[0].segments);
  nodeGroup.append("circle")
    .attr("r", 25)
    .attr("fill", (d) => {
      if (segments.has(d.id)) {
        return "green"
      }
      return "gray"
    })
    .attr("stroke", "#fff")
    .attr("stroke-width", 1.5);

  nodeGroup.append("text")
    .attr("text-anchor", "middle")
    .attr("dy", "0.35em")
    .attr("font-size", 20)
    .attr("pointer-events", "none")
    .text(d => d.id);

  nodeGroup.append("title").text(d => d.id);
}

function drag(simulation) {
  return d3.drag()
    .on("start", (event, d) => {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    })
    .on("drag", (event, d) => {
      d.fx = event.x;
      d.fy = event.y;
    })
    .on("end", (event, d) => {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    });
}

function randomColor() {
  return `hsl(${Math.random() * 360}, 60%, 60%)`;
}
