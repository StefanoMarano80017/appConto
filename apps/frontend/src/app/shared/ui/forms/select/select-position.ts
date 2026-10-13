/** Distanza in pixel fra trigger e pannello. */
const PANEL_GAP = 4;
/** Margine in pixel dal bordo del viewport quando il pannello va spostato a sinistra. */
const VIEWPORT_MARGIN = 4;

/** Le misure del trigger che servono: un `DOMRect` va bene così com'è. */
export interface PlacementRect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly width: number;
}

/** Dimensioni in pixel (del pannello o del viewport). */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Dove va il pannello, in pixel: esattamente uno fra `top` e `bottom` vale `null`. */
export interface PanelPlacement {
  readonly above: boolean;
  readonly top: number | null;
  readonly bottom: number | null;
  readonly left: number;
}

/**
 * Calcola la posizione del pannello `fixed` dal trigger, dalle misure del
 * pannello e dal viewport. Sotto per default; sopra solo se il pannello, alla
 * sua altezza reale, sotto non ci sta e sopra c'è più spazio.
 */
export function panelPlacement(trigger: PlacementRect, panel: Size, viewport: Size): PanelPlacement {
  const spaceBelow = viewport.height - trigger.bottom - PANEL_GAP - VIEWPORT_MARGIN;
  const spaceAbove = trigger.top - PANEL_GAP - VIEWPORT_MARGIN;
  const above = panel.height > spaceBelow && spaceAbove > spaceBelow;

  // Il pannello ha `min-width` pari al trigger: non è mai più stretto di così.
  const width = Math.max(panel.width, trigger.width);
  // Allineato al trigger, ma spostato a sinistra se uscirebbe dal viewport.
  const maxLeft = viewport.width - width - VIEWPORT_MARGIN;

  return {
    above,
    top: above ? null : trigger.bottom + PANEL_GAP,
    bottom: above ? viewport.height - trigger.top + PANEL_GAP : null,
    left: Math.max(VIEWPORT_MARGIN, Math.min(trigger.left, maxLeft)),
  };
}
