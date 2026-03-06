function renderMap(containerElement, map) {
  if (!containerElement || !map) {
    return;
  }
  for (let y = 0; y < map.config.height; y++) {
    for (let x = 0; x < map.config.width; x++) {
      let tile = map.layout[y][x];
      let tileElement = document.createElement("div");
      tileElement.className = "tile " + map.tiles[tile].cssClass;
      tileElement.style.left = x * map.config.tileSize + "px";
      tileElement.style.top = y * map.config.tileSize + "px";
      tileElement.style.width = map.config.tileSize + "px";
      tileElement.style.height = map.config.tileSize + "px";
      containerElement.appendChild(tileElement);
    }
  }
}
export default renderMap;
