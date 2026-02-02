/* ================================
   Global state
================================ */

let versions = [];
let activeIndex = 0;

const sidebar = document.getElementById("sidebar");
const main = document.getElementById("main");

/* keep positions between renders for smooth morphing */
const previousPositions = new Map();

/* ================================
   Persistent SVG + layers (IMPORTANT)
================================ */

const svg = d3
  .select(main)
  .append("svg")
  .attr("width", "100%")
  .attr("height", "100%");

svg.append("defs")
  .append("marker")
  .attr("id", "arrow")
  .attr("viewBox", "0 -5 10 10")
  .attr("refX", 40)
  .attr("refY", 0)
  .attr("markerWidth", 8)
  .attr("markerHeight", 8)
  .attr("markerUnits", "strokeWidth")
  .attr("orient", "auto")
  .append("path")
  .attr("d", "M0,-5L10,0L0,5")
  .attr("fill", "#999");

/* layer order matters */
const componentLayer = svg.append("g");
const componentLabelLayer = svg.append("g");
const linkLayer = svg.append("g");
const nodeLayer = svg.append("g");

/* ================================
   Load once
================================ */

fetch("/versions")
  .then(res => res.json())
  .then(data => {
    versions = data;
    buildSidebar();
    renderVersion(0);
  });

/* ================================
   Sidebar
================================ */

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

  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      activeIndex = (activeIndex + 1) % versions.length;
      renderVersion(activeIndex);
      updateActive();
      e.preventDefault();
    }

    if (e.key === "ArrowUp") {
      activeIndex = (activeIndex - 1 + versions.length) % versions.length;
      renderVersion(activeIndex);
      updateActive();
      e.preventDefault();
    }
  });

}

function updateActive() {
  [...sidebar.children].forEach((el, i) =>
    el.classList.toggle("active", i === activeIndex)
  );
}

/* ================================
   Helpers
================================ */

function parseAdjacencyList(json) {
  const data = JSON.parse(json);

  return new Map(
    data.map(([key, values]) => [key, new Set(values)])
  );
}

function colorForNodeId(id) {
  const hue = (id * 137.508) % 360; // nice distribution
  return `hsl(${hue}, 60%, 55%)`;
}

function layoutComponentsWithDagre(nodes, links, versionMap, width, height) {
  const components = d3.group(nodes, d => versionMap.get(d.id));

  const GAP_X = 200;
  let cursorX = 0;

  const allPositions = [];

  // stable order (VERY IMPORTANT)
  const sorted = [...components.entries()]
    .sort((a, b) => a[0] - b[0]); // by agglomerate id

  for (const [aggId, compNodes] of sorted) {
    const compSet = new Set(compNodes.map(n => n.id));

    const compLinks = links.filter(
      l => compSet.has(l.source) && compSet.has(l.target)
    );

    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: "LR",
      nodesep: 50,
      edgesep: 50,
      ranksep: 100,
    });

    g.setDefaultEdgeLabel(() => ({}));

    compNodes.forEach(n =>
      g.setNode(n.id, { width: 50, height: 50 })
    );

    compLinks.forEach(l =>
      g.setEdge(l.source, l.target)
    );

    dagre.layout(g);

    // compute component bbox
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    compNodes.forEach(n => {
      const pos = g.node(n.id);
      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x);
      minY = Math.min(minY, pos.y);
      maxY = Math.max(maxY, pos.y);
    });

    const w = maxX - minX;

    // shift into row layout
    compNodes.forEach(n => {
      const pos = g.node(n.id);
      n.x = pos.x - minX + cursorX;
      n.y = pos.y;

      allPositions.push(n);
    });

    cursorX += w + GAP_X;
  }

  // -------- center entire layout (fix top-left problem)

  const xs = nodes.map(n => n.x);
  const ys = nodes.map(n => n.y);

  const graphW = Math.max(...xs) - Math.min(...xs);
  const graphH = Math.max(...ys) - Math.min(...ys);

  const offsetX = (width - graphW) / 2 - Math.min(...xs);
  const offsetY = (height - graphH) / 2 - Math.min(...ys);

  nodes.forEach(n => {
    n.x += offsetX;
    n.y += offsetY;
  });
}



/* ================================
   Main render with transitions
================================ */

function renderVersion(index) {
  const { versionMap: versionMapJSON, adjacencyList: adjacencyListJSON, storeState } =
    versions[index];

  const versionMap = new Map(
    Object.entries(versionMapJSON).map(([k, v]) => [Number(k), v])
  );

  const adjacencyList = parseAdjacencyList(adjacencyListJSON);

  const width = main.clientWidth;
  const height = main.clientHeight;

  /* ---------- build nodes/links ---------- */

  const nodes = [...versionMap.keys()].map(id => ({ id }));
  const nodeById = new Map(nodes.map(n => [n.id, n]));


  const links = [];
  for (const [from, tos] of adjacencyList.entries()) {
    tos.forEach(to => {
      links.push({ source: from, target: to });
    });
  }
  links.forEach(l => {
    l.source = nodeById.get(l.source);
    l.target = nodeById.get(l.target);
  });


  /* ---------- seed previous positions ---------- */

  nodes.forEach(n => {
    const prev = previousPositions.get(n.id);
    if (prev) {
      n.x = prev.x;
      n.y = prev.y;
    }
  });

  /* ---------- simulate offscreen ---------- */

  layoutComponentsWithDagre(nodes, links, versionMap, width, height);



  /* save positions for next render */
  nodes.forEach(n =>
    previousPositions.set(n.id, { x: n.x, y: n.y })
  );

  /* ---------- group components ---------- */

  const components = d3.group(nodes, d => versionMap.get(d.id));

  const compData = [...components.entries()].map(([aggId, compNodes]) => {
    const pad = 50;
    const xs = compNodes.map(d => d.x);
    const ys = compNodes.map(d => d.y);

    return {
      id: aggId,
      x: Math.min(...xs) - pad,
      y: Math.min(...ys) - pad,
      w: Math.max(...xs) - Math.min(...xs) + 2 * pad,
      h: Math.max(...ys) - Math.min(...ys) + 2 * pad
    };
  });

  const segments = new Map(storeState.annotation.volumes[0].segments);

  const t = svg.transition().duration(600);

  /* ================================
     COMPONENT RECTANGLES
  ================================ */

  componentLayer
    .selectAll("rect")
    .data(compData, d => d.id)
    .join(
      enter => enter.append("rect").attr("opacity", 0),
      update => update,
      exit => exit.transition(t).attr("opacity", 0).remove()
    )
    .transition(t)
    .attr("opacity", 1)
    .attr("x", d => d.x)
    .attr("y", d => d.y)
    .attr("width", d => d.w)
    .attr("height", d => d.h)
    .attr("rx", 12)
    .attr("ry", 12)
    .attr("fill", "none")
    .attr("stroke", "#666")
    .attr("stroke-dasharray", "4 2");

  componentLabelLayer
    .selectAll("text")
    .data(compData, d => d.id)
    .join(
      enter => enter.append("text").attr("opacity", 0),
      update => update,
      exit => exit.transition(t).attr("opacity", 0).remove()
    )
    .transition(t)
    .attr("opacity", 1)
    .attr("x", d => d.x + 6)
    .attr("y", d => d.y - 6)
    .attr("font-size", 14)
    .attr("font-family", "sans-serif")
    .attr("fill", d => segments.has(d.id) ? "green" : "gray")
    .text(d => `Agglomerate ${d.id}`);

  /* ================================
     LINKS
  ================================ */

  const linkSel = linkLayer
    .selectAll("line")
    .data(links, d => `${d.source.id}->${d.target.id}`);


  linkSel.exit()
    .transition()
    .style("opacity", 0)
    .remove();


  const linkEnter = linkSel.enter()
    .append("line")
    .attr("stroke", "#999")
    .attr("stroke-opacity", 0.6)
    .attr("marker-end", "url(#arrow)")
    .attr("x1", d => d.source.x)
    .attr("y1", d => d.source.y)
    .attr("x2", d => d.target.x)
    .attr("y2", d => d.target.y);

  const line = d3.line()
    .x(d => d.x)
    .y(d => d.y)
    .curve(d3.curveBundle.beta(0.5)); // makes edges curved

  linkSel.merge(linkEnter)
    .transition()
    .duration(600)
    .attr("x1", d => d.source.x)
    .attr("y1", d => d.source.y)
    .attr("x2", d => d.target.x)
    .attr("y2", d => d.target.y);
  /* ================================
     NODES
  ================================ */

  const nodeSel = nodeLayer
    .selectAll("g.node")
    .data(nodes, d => d.id);

  nodeSel.exit()
    .transition(t)
    .style("opacity", 0)
    .remove();

  const nodeEnter = nodeSel.enter()
    .append("g")
    .attr("class", "node")
    .style("opacity", 0);

  nodeEnter.append("circle")
    .attr("r", 25)
    .attr("stroke", "#fff")
    .attr("stroke-width", 1.5);

  nodeEnter.append("text")
    .attr("text-anchor", "middle")
    .attr("dy", "0.35em")
    .attr("font-size", 20)
    .attr("pointer-events", "none");

  const nodeMerged = nodeEnter.merge(nodeSel);

  nodeMerged.select("circle")
    .attr("fill", "gray");

  nodeMerged.select("text")
    .text(d => d.id);

  nodeMerged
    .transition(t)
    .style("opacity", 1)
    .attr("transform", d => `translate(${d.x}, ${d.y})`);
}
