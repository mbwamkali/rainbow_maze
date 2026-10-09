/**
 * @file Builds mazes off the main thread so the page stays responsive on large sizes.
 *
 * Receives `{colors, size, style}` (the arguments to buildGrid()) and replies with
 * `{result}`, the finished Maze, or `{error}`, the message of the error it threw.
 */
importScripts("maze.js");

onmessage = ({ data: { colors, size, style } }) => {
  try {
    postMessage({ result: buildGrid(colors, size, style) });
  } catch (e) {
    postMessage({ error: e.message });
  }
};
