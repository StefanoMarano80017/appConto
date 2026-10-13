import { panelPlacement, PlacementRect } from './select-position';

const VIEWPORT = { width: 1000, height: 800 };
const TRIGGER: PlacementRect = { top: 100, bottom: 130, left: 20, width: 200 };

describe('panelPlacement', () => {
  it('per default sta sotto il trigger', () => {
    const placement = panelPlacement(TRIGGER, { width: 250, height: 100 }, VIEWPORT);

    expect(placement.above).toBe(false);
    expect(placement.top).toBe(134);
    expect(placement.bottom).toBeNull();
  });

  it('va sopra se sotto non ci sta e sopra c\'è più spazio', () => {
    const trigger = { ...TRIGGER, top: 620, bottom: 650 };

    const placement = panelPlacement(trigger, { width: 250, height: 200 }, VIEWPORT);

    expect(placement.above).toBe(true);
    expect(placement.bottom).toBe(800 - 620 + 4);
    expect(placement.top).toBeNull();
  });

  it('resta sotto se ci sta, anche con più spazio sopra', () => {
    const trigger = { ...TRIGGER, top: 620, bottom: 650 };

    const placement = panelPlacement(trigger, { width: 250, height: 100 }, VIEWPORT);

    expect(placement.above).toBe(false);
    expect(placement.top).toBe(654);
  });

  it('resta sotto se non ci sta ma sopra lo spazio non è maggiore', () => {
    const placement = panelPlacement(TRIGGER, { width: 250, height: 900 }, VIEWPORT);

    expect(placement.above).toBe(false);
    expect(placement.top).toBe(134);
  });

  it('allinea il bordo sinistro al trigger', () => {
    expect(panelPlacement(TRIGGER, { width: 250, height: 100 }, VIEWPORT).left).toBe(20);
  });

  it('si sposta a sinistra se uscirebbe dal bordo destro, col margine', () => {
    const trigger = { ...TRIGGER, left: 900 };

    expect(panelPlacement(trigger, { width: 250, height: 100 }, VIEWPORT).left).toBe(1000 - 250 - 4);
  });

  it('non scende sotto il margine se il viewport è più stretto del pannello', () => {
    const placement = panelPlacement(TRIGGER, { width: 250, height: 100 }, { width: 200, height: 800 });

    expect(placement.left).toBe(4);
  });

  it('con un trigger più largo del pannello il bordo destro usa la larghezza del trigger', () => {
    const trigger = { ...TRIGGER, left: 700, width: 400 };

    expect(panelPlacement(trigger, { width: 250, height: 100 }, VIEWPORT).left).toBe(1000 - 400 - 4);
  });
});
