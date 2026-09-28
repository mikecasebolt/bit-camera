// Nine 120×120 frames from the Figma mark, normalized to its 5×5 pixel grid.
const frames = [
  [[2, 2]],
  [[2, 2], [2, 0]],
  [[2, 2], [2, 0], [0, 2]],
  [[2, 2], [2, 0], [2, 4], [0, 2]],
  [[2, 2], [2, 0], [2, 4], [4, 2], [0, 2]],
  [[2, 2]],
  [[1, 1], [2, 2], [3, 1], [1, 3], [3, 3]],
  [[1, 1], [0, 0], [0, 4], [2, 2], [3, 1], [4, 0], [4, 4], [1, 3], [3, 3]],
  [[1, 1], [2, 2], [3, 1], [1, 3], [3, 3]],
];

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      {frames.map((pixels, frame) => (
        <svg key={frame} viewBox="0 0 120 120" width="40" height="40"
          className="brand-mark-frame" style={{ animationDelay: `${frame * 180}ms` }}>
          {pixels.map(([x, y]) => (
            <rect key={`${x}-${y}`} x={x * 24} y={y * 24} width="24" height="24" />
          ))}
        </svg>
      ))}
    </span>
  );
}
