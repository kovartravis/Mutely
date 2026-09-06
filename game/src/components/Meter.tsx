/**
 * A block meter. Fill and track are separate spans -- rendered as one string the
 * two glyphs are near-indistinguishable at this size and read as a grey blob.
 */
export default function Meter({
  value,
  max = 100,
  width = 8,
  tone,
}: {
  value: number;
  max?: number;
  width?: number;
  tone?: string;
}) {
  const fraction = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const filled = Math.round(fraction * width);
  return (
    <span style={{ whiteSpace: 'pre' }}>
      <span style={{ color: tone ?? 'var(--ink)' }}>{'▇'.repeat(filled)}</span>
      <span style={{ color: 'var(--rule)' }}>{'▇'.repeat(width - filled)}</span>
    </span>
  );
}
