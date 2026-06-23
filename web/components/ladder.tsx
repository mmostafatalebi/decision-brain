import { Fragment } from "react";

/**
 * The promotion ladder, rendered as a 4-dot horizontal track:
 *   ●─○─○─○  candidate
 *   ○─●─○─○  emerging
 *   ○─○─●─○  validated
 *   ○─○─○─●  decision_grade
 * Filled dot = current position (emerald, with glow). Server-renderable.
 */
export function Ladder({
  position,
  label,
}: {
  position: number;
  label: string;
}) {
  return (
    <div className="inline-flex flex-col gap-1" title={`ladder: ${label}`}>
      <div className="flex items-center" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <Fragment key={i}>
            {i > 0 ? <span className="h-px w-2 bg-line" /> : null}
            <span
              className={
                i === position
                  ? "h-2 w-2 rounded-full bg-em shadow-[0_0_8px_var(--em)]"
                  : "h-2 w-2 rounded-full border border-line-2"
              }
            />
          </Fragment>
        ))}
      </div>
      <span className="font-mono text-[10px] uppercase tracking-wider text-tm">
        {label}
      </span>
    </div>
  );
}
