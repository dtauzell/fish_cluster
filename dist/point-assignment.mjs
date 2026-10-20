/**
 * Find a one-to-one assignment with the lowest total cost (Hungarian algorithm).
 * Each row can instead choose its own unmatched slot. This prevents two tracks
 * from claiming one detection and avoids the conflicts of nearest-first matching.
 * Returns a column index per row, or -1 when leaving it unmatched costs less.
 */
export function minimumCostAssignment(costs, unmatchedCost) {
  if (!costs.length) return [];
  const rowCount = costs.length, realColumns = costs[0].length;
  const columnCount = realColumns + rowCount;
  const rowPotential = Array(rowCount + 1).fill(0);
  const columnPotential = Array(columnCount + 1).fill(0);
  const owner = Array(columnCount + 1).fill(0);
  const previousColumn = Array(columnCount + 1).fill(0);
  for (let row = 1; row <= rowCount; row++) {
    owner[0] = row;
    let column = 0;
    const bestCost = Array(columnCount + 1).fill(Infinity);
    const visited = Array(columnCount + 1).fill(false);
    do {
      visited[column] = true;
      const currentRow = owner[column];
      let adjustment = Infinity, nextColumn = 0;
      for (let candidate = 1; candidate <= columnCount; candidate++) {
        if (visited[candidate]) continue;
        const cost = candidate <= realColumns ? costs[currentRow - 1][candidate - 1] : unmatchedCost;
        const reducedCost = cost - rowPotential[currentRow] - columnPotential[candidate];
        if (reducedCost < bestCost[candidate]) {
          bestCost[candidate] = reducedCost;
          previousColumn[candidate] = column;
        }
        if (bestCost[candidate] < adjustment) { adjustment = bestCost[candidate]; nextColumn = candidate; }
      }
      for (let candidate = 0; candidate <= columnCount; candidate++) {
        if (visited[candidate]) {
          rowPotential[owner[candidate]] += adjustment;
          columnPotential[candidate] -= adjustment;
        } else bestCost[candidate] -= adjustment;
      }
      column = nextColumn;
    } while (owner[column] !== 0);
    do {
      const preceding = previousColumn[column];
      owner[column] = owner[preceding];
      column = preceding;
    } while (column !== 0);
  }
  const assignment = Array(rowCount).fill(-1);
  for (let column = 1; column <= realColumns; column++) {
    if (owner[column] && costs[owner[column] - 1][column - 1] < unmatchedCost) assignment[owner[column] - 1] = column - 1;
  }
  return assignment;
}
