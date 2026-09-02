import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Truncate } from './truncate';

/**
 * Il testo troncato e il suo tooltip.
 *
 * Le cose che contano qui: che il tooltip ci sia **solo** dove il testo è
 * davvero tagliato — altrimenti ripeterebbe ciò che si legge già — che segua i
 * cambi di spazio, perché la stessa cella tronca o no secondo la larghezza che
 * le tocca, e che il dato mostrato resti intero nel tooltip.
 */

@Component({
  imports: [Truncate],
  template: `<p appTruncate>{{ text() }}</p>`
})
class Host {
  readonly text = signal('BONIFICO A FAVORE DI MARIO ROSSI');
}

@Component({
  imports: [Truncate],
  template: `
    <p appTruncate>
      Restituzione · {{ name() }}
    </p>
  `
})
class MultilineHost {
  readonly name = signal('Mario Rossi');
}

/**
 * jsdom non impagina: `scrollWidth` e `clientWidth` valgono sempre zero, e
 * senza dettarli non ci sarebbe niente da misurare.
 */
const layout = (element: HTMLElement, content: number, available: number): void => {
  Object.defineProperty(element, 'scrollWidth', { value: content, configurable: true });
  Object.defineProperty(element, 'clientWidth', { value: available, configurable: true });
};

describe('appTruncate', () => {
  let fixture: ComponentFixture<Host>;
  let paragraph: HTMLElement;

  /** Il puntatore che arriva sul testo: l'istante in cui il tooltip conta. */
  const hover = (): void => {
    paragraph.dispatchEvent(new MouseEvent('mouseenter'));
    TestBed.tick();
  };

  const tooltip = (): string | null => paragraph.getAttribute('title');

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    paragraph = fixture.nativeElement.querySelector('p');
  });

  it('tronca col foglio di stile, non nel dato', () => {
    // Il testo resta intero nel DOM: a nascondere una parte è la classe.
    expect(paragraph.classList.contains('truncate')).toBe(true);
    expect(paragraph.textContent?.trim()).toBe('BONIFICO A FAVORE DI MARIO ROSSI');
  });

  it('non mostra il tooltip quando il testo entra nello spazio', () => {
    layout(paragraph, 200, 200);
    hover();

    expect(tooltip()).toBeNull();
  });

  it('mostra il testo intero quando è tagliato', () => {
    layout(paragraph, 420, 200);
    hover();

    expect(tooltip()).toBe('BONIFICO A FAVORE DI MARIO ROSSI');
  });

  it('toglie il tooltip quando il testo torna a entrare', () => {
    layout(paragraph, 420, 200);
    hover();
    expect(tooltip()).not.toBeNull();

    layout(paragraph, 200, 200);
    hover();

    expect(tooltip()).toBeNull();
  });

  it('non si fa ingannare da un pixel di arrotondamento', () => {
    // Gli arrotondamenti sub-pixel del browser farebbero comparire il tooltip
    // su testi che si leggono per intero.
    layout(paragraph, 201, 200);
    hover();

    expect(tooltip()).toBeNull();
  });

  it('segue il contenuto quando la riga cambia', () => {
    layout(paragraph, 420, 200);
    hover();

    fixture.componentInstance.text.set('PAGAMENTO POS ESSELUNGA VIA RIPAMONTI');
    TestBed.tick();
    hover();

    expect(tooltip()).toBe('PAGAMENTO POS ESSELUNGA VIA RIPAMONTI');
  });

  it('rimisura da sé quando cambia lo spazio disponibile', async () => {
    // Senza ResizeObserver il tooltip nascerebbe solo al passaggio del mouse:
    // una finestra ridotta lascerebbe testo tagliato e nessun modo di leggerlo
    // fino a quel momento.
    const restore = installFakeResizeObserver();

    try {
      const resized = TestBed.createComponent(Host);
      await resized.whenStable();
      const element: HTMLElement = resized.nativeElement.querySelector('p');

      layout(element, 420, 200);
      FakeResizeObserver.latest?.fire();
      TestBed.tick();

      expect(element.getAttribute('title')).toBe('BONIFICO A FAVORE DI MARIO ROSSI');
    } finally {
      restore();
    }
  });
});

describe('appTruncate su testo composto', () => {
  it('mette nel tooltip il testo come lo si legge', async () => {
    // Gli spazi con cui il template va a capo non sono contenuto: nel tooltip
    // devono comparire collassati, come li rende il browser.
    const fixture = TestBed.createComponent(MultilineHost);
    await fixture.whenStable();
    const paragraph: HTMLElement = fixture.nativeElement.querySelector('p');

    layout(paragraph, 420, 200);
    paragraph.dispatchEvent(new MouseEvent('mouseenter'));
    TestBed.tick();

    expect(paragraph.getAttribute('title')).toBe('Restituzione · Mario Rossi');
  });
});

/** Un osservatore che si può far scattare a mano: jsdom non ne ha uno vero. */
class FakeResizeObserver {
  static latest: FakeResizeObserver | null = null;

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.latest = this;
  }

  /** Il vero `ResizeObserver` richiama subito con la dimensione attuale. */
  observe(): void {
    this.fire();
  }

  unobserve(): void {}

  disconnect(): void {}

  fire(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

/** Installa il finto osservatore e restituisce come rimetterlo a posto. */
function installFakeResizeObserver(): () => void {
  const global = globalThis as unknown as { ResizeObserver?: typeof ResizeObserver };
  const original = global.ResizeObserver;

  FakeResizeObserver.latest = null;
  global.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;

  return () => {
    if (original === undefined) {
      delete global.ResizeObserver;
      return;
    }

    global.ResizeObserver = original;
  };
}
