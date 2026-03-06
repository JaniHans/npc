const MAX_GRAPH_FPS = 120;

export function createPerformanceOverlay(graphSampleCount = 50) {
  const container = document.createElement("div");
  container.className = "performance-ui";

  const stats = document.createElement("div");
  stats.className = "performance-ui-stats";
  stats.textContent = "FPS: --, 1% Low: --, Frame Time: --ms, TPS: --";
  container.appendChild(stats);

  const graph = document.createElement("div");
  graph.className = "performance-ui-graph";
  const bars = [];
  for (let index = 0; index < graphSampleCount; index++) {
    const bar = document.createElement("span");
    bar.className = "performance-ui-bar";
    graph.appendChild(bar);
    bars.push(bar);
  }
  container.appendChild(graph);

  const graphFpsValues = [];

  function update({ fps, tps, onePercentLow, frameTimeMs, fpsThisFrame }) {
    const displayFps = fps > 0 ? fps.toFixed(1) : "--";
    const displayTps = tps > 0 ? tps.toFixed(2) : "--";
    stats.textContent =
      `FPS: ${displayFps}, 1% Low: ${onePercentLow.toFixed(1)}, ` +
      `Frame Time: ${frameTimeMs.toFixed(1)}ms, TPS: ${displayTps}`;

    graphFpsValues.push(Math.round(fpsThisFrame));
    if (graphFpsValues.length > graphSampleCount) {
      graphFpsValues.shift();
    }

    const leadingEmptyBars = graphSampleCount - graphFpsValues.length;
    for (let index = 0; index < graphSampleCount; index++) {
      const value = index < leadingEmptyBars ? 0 : graphFpsValues[index - leadingEmptyBars];
      const clamped = Math.max(0, Math.min(value, MAX_GRAPH_FPS));
      const heightPercent = (clamped / MAX_GRAPH_FPS) * 100;
      bars[index].style.height = `${Math.max(2, heightPercent)}%`;
    }
  }

  function setVisible(isVisible) {
    container.classList.toggle("performance-ui--hidden", !isVisible);
  }

  function dispose() {
    container.remove();
  }

  return {
    element: container,
    update,
    setVisible,
    dispose,
  };
}
