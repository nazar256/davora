export interface AnchoredScrollAxis {
  target: number;
  leadingPadding: number;
  trailingPadding: number;
}

export function resolveAnchoredScrollAxis(
  target: number,
  baseExtent: number,
  viewportExtent: number,
  leadingPadding: number,
  trailingPadding: number
): AnchoredScrollAxis {
  let nextTarget = target;
  let nextLeadingPadding = leadingPadding;
  let nextTrailingPadding = trailingPadding;

  const removableLeadingPadding = Math.min(nextLeadingPadding, Math.max(0, nextTarget));
  nextLeadingPadding -= removableLeadingPadding;
  nextTarget -= removableLeadingPadding;

  let maxTarget = Math.max(0, baseExtent + nextLeadingPadding + nextTrailingPadding - viewportExtent);
  const removableTrailingPadding = Math.min(nextTrailingPadding, Math.max(0, maxTarget - nextTarget));
  nextTrailingPadding -= removableTrailingPadding;
  maxTarget = Math.max(0, baseExtent + nextLeadingPadding + nextTrailingPadding - viewportExtent);

  if (nextTarget < 0) {
    nextLeadingPadding += -nextTarget;
    nextTarget = 0;
  } else if (nextTarget > maxTarget) {
    nextTrailingPadding += Math.max(
      0,
      nextTarget + viewportExtent - (baseExtent + nextLeadingPadding + nextTrailingPadding)
    );
  }

  maxTarget = Math.max(0, baseExtent + nextLeadingPadding + nextTrailingPadding - viewportExtent);
  return {
    target: Math.max(0, Math.min(maxTarget, nextTarget)),
    leadingPadding: nextLeadingPadding,
    trailingPadding: nextTrailingPadding
  };
}
