// Builds mazes off the main thread so the page stays responsive on large sizes.
importScripts("maze.js");

onmessage = ({ data: { colors, size, style } }) => {
  try {
    postMessage({ result: buildGrid(colors, size, style) });
  } catch (e) {
    postMessage({ error: e.message });
  }
};
