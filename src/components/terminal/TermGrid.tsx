import React from "react";

// TermGrid
export function TermGrid({
  n,
  active
}) {
  let cols;
  let rows;
  if (n <= 1) {
    cols = 1;
    rows = 1;
  } else if (n === 2) {
    cols = 2;
    rows = 1;
  } else if (n % 2 === 1) {
    cols = (n - 1) / 2 + 1;
    rows = 2;
  } else {
    cols = n / 2;
    rows = 2;
  }
  const cells = [];
  if (n % 2 === 1 && n >= 3) {
    const leftCols = (n - 1) / 2;
    for (let i = 0; i < n - 1; i++) {
      const col = Math.floor(i / 2) + 1;
      const row = i % 2 + 1;
      cells.push({
        col,
        row,
        rowSpan: 1
      });
    }
    cells.push({
      col: leftCols + 1,
      row: 1,
      rowSpan: 2
    });
  } else {
    for (let i = 0; i < n; i++) {
      const col = i % cols + 1;
      const row = Math.floor(i / cols) + 1;
      cells.push({
        col,
        row,
        rowSpan: 1
      });
    }
  }
  const color = active ? "bg-red-400" : "bg-gray-600";
  return <div className="grid gap-[2px]" style={{
    gridTemplateColumns: `repeat(${cols}, 1fr)`,
    gridTemplateRows: `repeat(${rows}, 1fr)`,
    width: 26,
    height: 20
  }}>
      {cells.map((c, i) => <div className={`rounded-[1px] ${color}`} style={{
      gridColumn: `${c.col}`,
      gridRow: c.rowSpan === 2 ? `${c.row} / span 2` : `${c.row}`
    }} />)}
    </div>;
}