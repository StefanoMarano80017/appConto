# Categorie gestibili a runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire il doppio seed delle categorie (migrazione SQL + file TypeScript) con un CRUD completo backend+frontend che usa il database come unica fonte di verità, gestibile a runtime senza riavvio.

**Architecture:** Il database diventa l'unica fonte di verità per le categorie. La migrazione SQL resta responsabile solo del bootstrap al primo avvio. Il backend espone endpoint REST (POST/PATCH/DELETE oltre al GET esistente) con la logica di dominio in `categories.service.ts`; il reset dell'archivio smette di toccare le categorie. Il frontend ottiene una nuova pagina Angular standalone che consuma questi endpoint, seguendo i pattern già in uso (signal-based state, conferma a due passi per le eliminazioni).

**Tech Stack:** Express 5 + Drizzle ORM + better-sqlite3 (backend), Angular standalone components + signals + RxJS/HttpClient (frontend), node:test (backend test runner via tsx), Vitest (frontend test runner).

**Spec:** [docs/superpowers/specs/2026-09-22-categorie-runtime-design.md](../specs/2026-09-22-categorie-runtime-design.md)

## Global Constraints

- Nessuna migrazione di schema: la tabella `categories` resta `(id, name UNIQUE, color)`.
- "Da classificare" (id fisso `c9bfcd74-e342-4a3f-8b0c-116f89236d51`) non può essere rinominata né eliminata; il suo colore resta modificabile.
- Eliminare una categoria riassegna automaticamente tutti i merchant collegati a "Da classificare", nella stessa transazione atomica della cancellazione.
- Il reset dell'archivio (`resetService.run()`) non tocca più la tabella `categories`: le categorie, incluse quelle create dall'utente, sopravvivono all'azzeramento.
- Nessun test di route dedicato per `categories` (coerente con `merchants`, che non ne ha): il comportamento di dominio si verifica a livello di `categoriesService` con un database SQLite temporaneo reale, non mockato.
- Il frontend duplica la costante dell'id di "Da classificare" (nessuna condivisione di codice tra backend e frontend nel progetto).
- `GET /categories` deve restituire `merchantCount` per categoria; questo NON deve alterare `toCategoryDto`/`CategoryDto` esistenti, già usati da `merchants.dto.ts` per annidare la categoria di un merchant senza quel campo.

## Review Focus

- Nome categoria vuoto o fatto di soli spazi in creazione/modifica → deve essere rifiutato con `ValidationError`, non salvato come stringa vuota.
- Colore assente (`null`) in creazione → deve essere accettato, non deve far fallire l'inserimento.
- Rinominare una categoria con lo stesso nome che ha già → non deve sollevare `ConflictError` per "duplicato con se stessa".
- Eliminare una categoria senza merchant assegnati (`merchantCount === 0`) → deve funzionare senza errori, nessuna riassegnazione necessaria.
- Reset dell'archivio dopo aver creato una categoria custom → la categoria custom deve sopravvivere, e il conteggio dei backup pre-reset creati da un test precedente nello stesso file non deve aumentare per via di un reset aggiuntivo introdotto per testare questo comportamento.

---

## Task 1: Creazione di una categoria (`categoriesService.create`)

**Files:**
- Modify: `apps/backend/src/modules/categories/category.model.ts`
- Modify: `apps/backend/src/modules/categories/categories.repository.ts`
- Modify: `apps/backend/src/modules/categories/categories.service.ts`
- Modify: `apps/backend/src/modules/categories/categories.routes.ts`
- Test: `apps/backend/src/modules/categories/categories.service.test.ts` (nuovo file)

**Interfaces:**
- Produces: `NewCategory` (`{ name: string; color: string | null }`), `createCategory(input: NewCategory): Category` in `category.model.ts`; `categoriesRepository.insert(category: Category): void`, `categoriesRepository.findByName(name: string): Category | null` in `categories.repository.ts`; `categoriesService.create(input: NewCategory): Category` in `categories.service.ts`, che lancia `ValidationError` per nome vuoto/spazi e `ConflictError` per nome duplicato.

- [ ] **Step 1: Scrivi il test fallente per la creazione**

Crea `apps/backend/src/modules/categories/categories.service.test.ts`:

```ts
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

// Il database di prova va scelto prima di caricare i moduli che aprono la connessione.
const databaseDir = mkdtempSync(path.join(tmpdir(), 'appconto-categories-'));
process.env.DATABASE_FILE = path.join(databaseDir, 'test.db');

const { runMigrations } = await import('../../db/client.js');
const { importService } = await import('../import/index.js');
const { merchantsService } = await import('../merchants/index.js');
const { categoriesService, FALLBACK_CATEGORY_ID } = await import('./categories.service.js');
const { ConflictError, NotFoundError, ValidationError } = await import('../../shared/errors.js');

runMigrations();

after(() => {
  try {
    rmSync(databaseDir, { recursive: true, force: true });
  } catch {
    // su Windows il file può restare bloccato: è comunque una cartella temporanea
  }
});

describe('creazione di una categoria', () => {
  it('crea una categoria con un id nuovo', () => {
    const categoria = categoriesService.create({ name: 'Categoria di prova', color: '#123456' });

    assert.ok(categoria.id.length > 0);
    assert.equal(categoria.name, 'Categoria di prova');
    assert.equal(categoria.color, '#123456');
  });

  it('accetta un colore nullo', () => {
    const categoria = categoriesService.create({ name: 'Senza colore', color: null });

    assert.equal(categoria.color, null);
  });

  it('rifiuta un nome già esistente', () => {
    categoriesService.create({ name: 'Doppione', color: null });

    assert.throws(
      () => categoriesService.create({ name: 'Doppione', color: null }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictError);
        return true;
      },
    );
  });

  it('rifiuta un nome vuoto o fatto di soli spazi', () => {
    for (const name of ['', '   ']) {
      assert.throws(
        () => categoriesService.create({ name, color: null }),
        (error: unknown) => {
          assert.ok(error instanceof ValidationError);
          return true;
        },
      );
    }
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `npx tsx --test apps/backend/src/modules/categories/categories.service.test.ts`
Expected: FAIL — `categoriesService.create` non esiste, `FALLBACK_CATEGORY_ID` non esportata.

- [ ] **Step 3: Aggiungi `NewCategory` e `createCategory` al modello**

Modifica `apps/backend/src/modules/categories/category.model.ts`:

```ts
import { randomUUID } from 'node:crypto';

/**
 * Modello di dominio.
 *
 * Una categoria rappresenta una tipologia di spesa. Non contiene logica:
 * serve solo a raggruppare i merchant.
 */
export interface Category {
  id: string;
  name: string;
  /** Colore di visualizzazione, in formato esadecimale. */
  color: string | null;
}

/** Una categoria con il numero di merchant attualmente assegnati. */
export interface CategoryWithUsage extends Category {
  merchantCount: number;
}

export type NewCategory = Omit<Category, 'id'>;

/** Una categoria nasce con un identificativo nuovo, scelto dall'applicazione. */
export function createCategory(input: NewCategory): Category {
  return { id: randomUUID(), ...input };
}
```

- [ ] **Step 4: Aggiungi `insert` e `findByName` al repository**

Modifica `apps/backend/src/modules/categories/categories.repository.ts`:

```ts
import { asc, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import type { Category } from './category.model.js';
import { categories } from './categories.schema.js';

export const categoriesRepository = {
  findAll(): Category[] {
    return db.select().from(categories).orderBy(asc(categories.name)).all();
  },

  findById(id: string): Category | null {
    return db.select().from(categories).where(eq(categories.id, id)).get() ?? null;
  },

  findByName(name: string): Category | null {
    return db.select().from(categories).where(eq(categories.name, name)).get() ?? null;
  },

  insert(category: Category): void {
    db.insert(categories).values(category).run();
  },
};
```

- [ ] **Step 5: Aggiungi `create` al service, con `FALLBACK_CATEGORY_ID`**

Modifica `apps/backend/src/modules/categories/categories.service.ts`:

```ts
import { ConflictError, ValidationError } from '../../shared/errors.js';
import { type Category, type NewCategory, createCategory } from './category.model.js';
import { categoriesRepository } from './categories.repository.js';

/**
 * L'id fisso di "Da classificare": il ripiego usato dalla riassegnazione
 * quando una categoria viene eliminata. Non può essere rinominata né
 * eliminata (vedi `update` e `remove` più sotto).
 */
export const FALLBACK_CATEGORY_ID = 'c9bfcd74-e342-4a3f-8b0c-116f89236d51';

/** Servizio pubblico della feature: unico punto di accesso per le altre feature. */
export const categoriesService = {
  listAll(): Category[] {
    return categoriesRepository.findAll();
  },

  findById(id: string): Category | null {
    return categoriesRepository.findById(id);
  },

  create(input: NewCategory): Category {
    const name = input.name.trim();
    if (name === '') {
      throw new ValidationError('Il nome della categoria non può essere vuoto.');
    }
    if (categoriesRepository.findByName(name) !== null) {
      throw new ConflictError(`Esiste già una categoria con il nome "${name}".`);
    }

    const category = createCategory({ name, color: input.color });
    categoriesRepository.insert(category);

    return category;
  },
};
```

- [ ] **Step 6: Aggiungi la route POST**

Modifica `apps/backend/src/modules/categories/categories.routes.ts`:

```ts
import { Router, json } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../shared/errors.js';
import { toCategoryDto } from './categories.dto.js';
import { categoriesService } from './categories.service.js';

export const categoriesRouter = Router();

const createCategoryBodySchema = z.object({
  name: z.string().trim().min(1),
  color: z.string().trim().min(1).nullable().optional(),
});

// GET /categories
categoriesRouter.get('/', (_req, res) => {
  res.json(categoriesService.listAll().map(toCategoryDto));
});

// POST /categories
categoriesRouter.post('/', json(), (req, res) => {
  const body = createCategoryBodySchema.safeParse(req.body);
  if (!body.success) {
    throw new ValidationError('Il corpo della richiesta deve contenere "name".');
  }

  const created = categoriesService.create({ name: body.data.name, color: body.data.color ?? null });

  res.status(201).json(toCategoryDto(created));
});
```

(La route GET resta temporaneamente su `toCategoryDto`/`categoriesService.listAll()`: il Task 2 la aggiorna per includere `merchantCount`.)

- [ ] **Step 7: Esegui il test e verifica che passi**

Run: `npx tsx --test apps/backend/src/modules/categories/categories.service.test.ts`
Expected: PASS (4 test)

- [ ] **Step 8: Verifica il typecheck del backend**

Run: `npx tsc -p apps/backend/tsconfig.json --noEmit`
Expected: nessun errore

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/modules/categories/category.model.ts apps/backend/src/modules/categories/categories.repository.ts apps/backend/src/modules/categories/categories.service.ts apps/backend/src/modules/categories/categories.routes.ts apps/backend/src/modules/categories/categories.service.test.ts
git commit -m "feat(categories): add category creation (POST /categories)"
```

---

## Task 2: Elenco categorie con conteggio merchant (`listAllWithUsage`)

**Files:**
- Modify: `apps/backend/src/modules/categories/categories.repository.ts`
- Modify: `apps/backend/src/modules/categories/categories.service.ts`
- Modify: `apps/backend/src/modules/categories/categories.dto.ts`
- Modify: `apps/backend/src/modules/categories/categories.routes.ts`
- Test: `apps/backend/src/modules/categories/categories.service.test.ts`

**Interfaces:**
- Consumes: `Category`, `CategoryWithUsage` da `category.model.ts` (Task 1); `categoriesRepository.findAll()` (esistente).
- Produces: `categoriesRepository.countMerchantsByCategory(): Map<string, number>`; `categoriesService.listAllWithUsage(): CategoryWithUsage[]`; `CategoryWithUsageDto` e `toCategoryWithUsageDto(category: CategoryWithUsage): CategoryWithUsageDto` in `categories.dto.ts` (distinti da `CategoryDto`/`toCategoryDto`, che restano invariati e continuano a essere usati da `merchants.dto.ts`).

- [ ] **Step 1: Scrivi i test falliti per il conteggio**

Aggiungi a `apps/backend/src/modules/categories/categories.service.test.ts`, dopo il blocco `describe('creazione di una categoria', ...)`:

```ts
importService.importCsv(
  ['Data contabile,Descrizione,Importo', '01/05/2026,ESERCENTE DI PROVA,-10.00'].join('\r\n'),
);

describe('categorie con il numero di merchant assegnati', () => {
  it('conta zero merchant per una categoria appena creata', () => {
    const categoria = categoriesService.create({ name: 'Categoria vuota', color: null });

    const trovata = categoriesService.listAllWithUsage().find((c) => c.id === categoria.id);
    assert.ok(trovata);
    assert.equal(trovata.merchantCount, 0);
  });

  it('conta i merchant assegnati', () => {
    const categoria = categoriesService.create({ name: 'Categoria con merchant', color: null });
    const merchant = merchantsService.listAll().find((m) => m.name === 'ESERCENTE DI PROVA');
    assert.ok(merchant);
    merchantsService.assignCategory(merchant.id, categoria.id);

    const trovata = categoriesService.listAllWithUsage().find((c) => c.id === categoria.id);
    assert.ok(trovata);
    assert.equal(trovata.merchantCount, 1);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `npx tsx --test apps/backend/src/modules/categories/categories.service.test.ts`
Expected: FAIL — `categoriesService.listAllWithUsage` non esiste.

- [ ] **Step 3: Aggiungi `countMerchantsByCategory` al repository**

Modifica `apps/backend/src/modules/categories/categories.repository.ts` (aggiungi l'import e il metodo):

```ts
import { asc, count, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { merchants } from '../merchants/merchants.schema.js';
import type { Category } from './category.model.js';
import { categories } from './categories.schema.js';

export const categoriesRepository = {
  findAll(): Category[] {
    return db.select().from(categories).orderBy(asc(categories.name)).all();
  },

  findById(id: string): Category | null {
    return db.select().from(categories).where(eq(categories.id, id)).get() ?? null;
  },

  findByName(name: string): Category | null {
    return db.select().from(categories).where(eq(categories.name, name)).get() ?? null;
  },

  insert(category: Category): void {
    db.insert(categories).values(category).run();
  },

  /** Quanti merchant sono assegnati a ciascuna categoria, per id. */
  countMerchantsByCategory(): Map<string, number> {
    const rows = db
      .select({ categoryId: merchants.categoryId, total: count() })
      .from(merchants)
      .groupBy(merchants.categoryId)
      .all();

    const result = new Map<string, number>();
    for (const row of rows) {
      if (row.categoryId !== null) {
        result.set(row.categoryId, row.total);
      }
    }

    return result;
  },
};
```

- [ ] **Step 4: Aggiungi `listAllWithUsage` al service**

Modifica `apps/backend/src/modules/categories/categories.service.ts`, aggiungendo il metodo dentro l'oggetto `categoriesService` (dopo `findById`):

```ts
  /** Le categorie con il numero di merchant assegnati a ciascuna. */
  listAllWithUsage(): CategoryWithUsage[] {
    const counts = categoriesRepository.countMerchantsByCategory();

    return categoriesRepository.findAll().map((category) => ({
      ...category,
      merchantCount: counts.get(category.id) ?? 0,
    }));
  },
```

E aggiungi `CategoryWithUsage` all'import in testa al file:

```ts
import { type Category, type CategoryWithUsage, type NewCategory, createCategory } from './category.model.js';
```

- [ ] **Step 5: Aggiungi `CategoryWithUsageDto` al DTO**

Modifica `apps/backend/src/modules/categories/categories.dto.ts`:

```ts
import type { Category, CategoryWithUsage } from './category.model.js';

/** Rappresentazione della categoria esposta dalle API. */
export interface CategoryDto {
  id: string;
  name: string;
  color: string | null;
}

export function toCategoryDto(category: Category): CategoryDto {
  return {
    id: category.id,
    name: category.name,
    color: category.color,
  };
}

/**
 * Rappresentazione della categoria con il numero di merchant assegnati.
 *
 * Distinta da `CategoryDto`: quest'ultima è annidata dentro un merchant
 * (`merchants.dto.ts`), dove il conteggio non ha senso — un merchant ha una
 * sola categoria, non serve sapere quanti merchant condivide.
 */
export interface CategoryWithUsageDto extends CategoryDto {
  merchantCount: number;
}

export function toCategoryWithUsageDto(category: CategoryWithUsage): CategoryWithUsageDto {
  return {
    ...toCategoryDto(category),
    merchantCount: category.merchantCount,
  };
}
```

- [ ] **Step 6: Aggiorna la route GET**

Modifica `apps/backend/src/modules/categories/categories.routes.ts`: sostituisci l'import e il gestore GET.

```ts
import { toCategoryDto, toCategoryWithUsageDto } from './categories.dto.js';
```

```ts
// GET /categories
categoriesRouter.get('/', (_req, res) => {
  res.json(categoriesService.listAllWithUsage().map(toCategoryWithUsageDto));
});
```

(Il POST resta su `toCategoryDto(created)`: una categoria appena creata non può già avere merchant assegnati, non serve `listAllWithUsage` per quel caso — resta com'era nel Task 1.)

- [ ] **Step 7: Esegui il test e verifica che passi**

Run: `npx tsx --test apps/backend/src/modules/categories/categories.service.test.ts`
Expected: PASS (6 test)

- [ ] **Step 8: Verifica il typecheck**

Run: `npx tsc -p apps/backend/tsconfig.json --noEmit`
Expected: nessun errore

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/modules/categories/categories.repository.ts apps/backend/src/modules/categories/categories.service.ts apps/backend/src/modules/categories/categories.dto.ts apps/backend/src/modules/categories/categories.routes.ts apps/backend/src/modules/categories/categories.service.test.ts
git commit -m "feat(categories): include merchant count in GET /categories"
```

---

## Task 3: Utilizzo di una categoria (`usage`, `GET /categories/:id/usage`)

**Files:**
- Modify: `apps/backend/src/modules/categories/categories.repository.ts`
- Modify: `apps/backend/src/modules/categories/categories.service.ts`
- Modify: `apps/backend/src/modules/categories/categories.routes.ts`
- Test: `apps/backend/src/modules/categories/categories.service.test.ts`

**Interfaces:**
- Produces: `categoriesRepository.countMerchantsForCategory(id: string): number`; `categoriesService.usage(id: string): number` (lancia `NotFoundError` se l'id non esiste) — usata anche dal Task 4 per arricchire la risposta della `PATCH`.

- [ ] **Step 1: Scrivi i test falliti**

Aggiungi a `apps/backend/src/modules/categories/categories.service.test.ts`:

```ts
describe('utilizzo di una categoria', () => {
  it('restituisce zero per una categoria non assegnata a nessun merchant', () => {
    const categoria = categoriesService.create({ name: 'Categoria isolata', color: null });

    assert.equal(categoriesService.usage(categoria.id), 0);
  });

  it('lancia NotFoundError per un id inesistente', () => {
    assert.throws(
      () => categoriesService.usage('id-che-non-esiste'),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundError);
        return true;
      },
    );
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `npx tsx --test apps/backend/src/modules/categories/categories.service.test.ts`
Expected: FAIL — `categoriesService.usage` non esiste.

- [ ] **Step 3: Aggiungi `countMerchantsForCategory` al repository**

Modifica `apps/backend/src/modules/categories/categories.repository.ts`, aggiungi dentro l'oggetto `categoriesRepository` (dopo `countMerchantsByCategory`):

```ts
  /** Quanti merchant sono assegnati a una categoria specifica. */
  countMerchantsForCategory(id: string): number {
    const row = db.select({ total: count() }).from(merchants).where(eq(merchants.categoryId, id)).get();

    return row?.total ?? 0;
  },
```

- [ ] **Step 4: Aggiungi `usage` al service**

Modifica `apps/backend/src/modules/categories/categories.service.ts`: aggiungi l'import di `NotFoundError`, una funzione privata `requireCategory`, e il metodo `usage`.

```ts
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js';
```

```ts
function requireCategory(id: string): Category {
  const category = categoriesRepository.findById(id);
  if (category === null) {
    throw new NotFoundError(`Categoria "${id}" non trovata.`);
  }

  return category;
}
```

(Definisci `requireCategory` fuori dall'oggetto `categoriesService`, come fa `merchants.service.ts` con `requireMerchant`.)

```ts
  /** Quanti merchant sono assegnati a una categoria. */
  usage(id: string): number {
    requireCategory(id);

    return categoriesRepository.countMerchantsForCategory(id);
  },
```

- [ ] **Step 5: Aggiungi la route GET /:id/usage**

Modifica `apps/backend/src/modules/categories/categories.routes.ts`: aggiungi `import { ValidationError } from '../../shared/errors.js';` è già presente; aggiungi la funzione helper e la route.

```ts
function categoryId(value: string | undefined): string {
  if (value === undefined) {
    throw new ValidationError('Identificativo della categoria mancante.');
  }

  return value;
}

// GET /categories/:id/usage
categoriesRouter.get('/:id/usage', (req, res) => {
  const id = categoryId(req.params.id);

  res.json({ merchantCount: categoriesService.usage(id) });
});
```

Posiziona questa route **dopo** `GET /` e **prima** di `POST /` nel file (l'ordine tra loro non cambia il comportamento di Express per path diversi, ma mantiene le route raggruppate per verbo/risorsa in modo leggibile).

- [ ] **Step 6: Esegui il test e verifica che passi**

Run: `npx tsx --test apps/backend/src/modules/categories/categories.service.test.ts`
Expected: PASS (8 test)

- [ ] **Step 7: Verifica il typecheck**

Run: `npx tsc -p apps/backend/tsconfig.json --noEmit`
Expected: nessun errore

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/modules/categories/categories.repository.ts apps/backend/src/modules/categories/categories.service.ts apps/backend/src/modules/categories/categories.routes.ts apps/backend/src/modules/categories/categories.service.test.ts
git commit -m "feat(categories): add GET /categories/:id/usage"
```

---

## Task 4: Modifica di una categoria (`update`, `PATCH /categories/:id`)

**Files:**
- Modify: `apps/backend/src/modules/categories/categories.repository.ts`
- Modify: `apps/backend/src/modules/categories/categories.service.ts`
- Modify: `apps/backend/src/modules/categories/categories.routes.ts`
- Test: `apps/backend/src/modules/categories/categories.service.test.ts`

**Interfaces:**
- Consumes: `FALLBACK_CATEGORY_ID`, `requireCategory` (Task 3), `categoriesService.usage` (Task 3).
- Produces: `categoriesRepository.update(id: string, patch: { name?: string; color?: string | null }): void`; `categoriesService.update(id: string, patch: { name?: string; color?: string | null }): Category` — lancia `NotFoundError` per id inesistente, `ConflictError` per rename di "Da classificare" o nome duplicato, `ValidationError` per nome vuoto.

- [ ] **Step 1: Scrivi i test falliti**

Aggiungi a `apps/backend/src/modules/categories/categories.service.test.ts`:

```ts
describe('modifica di una categoria', () => {
  it('rinomina e cambia colore', () => {
    const categoria = categoriesService.create({ name: 'Da rinominare', color: '#111111' });

    const aggiornata = categoriesService.update(categoria.id, { name: 'Rinominata', color: '#222222' });

    assert.equal(aggiornata.name, 'Rinominata');
    assert.equal(aggiornata.color, '#222222');
  });

  it('non protesta se il nome resta lo stesso', () => {
    const categoria = categoriesService.create({ name: 'Nome stabile', color: null });

    const aggiornata = categoriesService.update(categoria.id, { name: 'Nome stabile', color: '#333333' });

    assert.equal(aggiornata.name, 'Nome stabile');
    assert.equal(aggiornata.color, '#333333');
  });

  it('rifiuta un nome già usato da un-altra categoria', () => {
    categoriesService.create({ name: 'Prima', color: null });
    const seconda = categoriesService.create({ name: 'Seconda', color: null });

    assert.throws(
      () => categoriesService.update(seconda.id, { name: 'Prima' }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictError);
        return true;
      },
    );
  });

  it('rifiuta un nome vuoto', () => {
    const categoria = categoriesService.create({ name: 'Nome da svuotare', color: null });

    assert.throws(
      () => categoriesService.update(categoria.id, { name: '   ' }),
      (error: unknown) => {
        assert.ok(error instanceof ValidationError);
        return true;
      },
    );
  });

  it('non permette di rinominare «Da classificare»', () => {
    assert.throws(
      () => categoriesService.update(FALLBACK_CATEGORY_ID, { name: 'Nuovo nome' }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictError);
        return true;
      },
    );
  });

  it('permette di cambiare il colore di «Da classificare»', () => {
    const aggiornata = categoriesService.update(FALLBACK_CATEGORY_ID, { color: '#abcdef' });

    assert.equal(aggiornata.color, '#abcdef');
    assert.equal(aggiornata.name, 'Da classificare');
  });

  it('lancia NotFoundError per un id inesistente', () => {
    assert.throws(
      () => categoriesService.update('id-che-non-esiste', { name: 'X' }),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundError);
        return true;
      },
    );
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `npx tsx --test apps/backend/src/modules/categories/categories.service.test.ts`
Expected: FAIL — `categoriesService.update` non esiste.

- [ ] **Step 3: Aggiungi `update` al repository**

Modifica `apps/backend/src/modules/categories/categories.repository.ts`, aggiungi dentro l'oggetto `categoriesRepository` (dopo `insert`):

```ts
  update(id: string, patch: { name?: string; color?: string | null }): void {
    db.update(categories).set(patch).where(eq(categories.id, id)).run();
  },
```

- [ ] **Step 4: Aggiungi `update` al service**

Modifica `apps/backend/src/modules/categories/categories.service.ts`, aggiungi il metodo dentro l'oggetto `categoriesService` (dopo `usage`):

```ts
  update(id: string, patch: { name?: string; color?: string | null }): Category {
    const category = requireCategory(id);

    const name = patch.name === undefined ? undefined : patch.name.trim();
    if (name !== undefined && name === '') {
      throw new ValidationError('Il nome della categoria non può essere vuoto.');
    }

    if (id === FALLBACK_CATEGORY_ID && name !== undefined && name !== category.name) {
      throw new ConflictError('«Da classificare» non può essere rinominata.');
    }

    if (name !== undefined && name !== category.name && categoriesRepository.findByName(name) !== null) {
      throw new ConflictError(`Esiste già una categoria con il nome "${name}".`);
    }

    const nextPatch = { ...patch, ...(name === undefined ? {} : { name }) };
    categoriesRepository.update(id, nextPatch);

    return { ...category, ...nextPatch };
  },
```

- [ ] **Step 5: Aggiungi la route PATCH**

Modifica `apps/backend/src/modules/categories/categories.routes.ts`: aggiungi lo schema e la route.

```ts
const updateCategoryBodySchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    color: z.string().trim().min(1).nullable().optional(),
  })
  .refine((body) => body.name !== undefined || body.color !== undefined, {
    message: 'Il corpo della richiesta deve contenere "name" e/o "color".',
  });
```

(senza il `.refine()`, un corpo vuoto `{}` supererebbe la validazione e produrrebbe un `UPDATE categories SET ...` senza colonne — SQL invalido, 500 invece di un chiaro 400)

```ts
// PATCH /categories/:id
categoriesRouter.patch('/:id', json(), (req, res) => {
  const id = categoryId(req.params.id);
  const body = updateCategoryBodySchema.safeParse(req.body);
  if (!body.success) {
    throw new ValidationError('Il corpo della richiesta deve contenere "name" e/o "color".');
  }

  const updated = categoriesService.update(id, body.data);
  const merchantCount = categoriesService.usage(id);

  res.json(toCategoryWithUsageDto({ ...updated, merchantCount }));
});
```

- [ ] **Step 6: Esegui il test e verifica che passi**

Run: `npx tsx --test apps/backend/src/modules/categories/categories.service.test.ts`
Expected: PASS (15 test)

- [ ] **Step 7: Verifica il typecheck**

Run: `npx tsc -p apps/backend/tsconfig.json --noEmit`
Expected: nessun errore

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/modules/categories/categories.repository.ts apps/backend/src/modules/categories/categories.service.ts apps/backend/src/modules/categories/categories.routes.ts apps/backend/src/modules/categories/categories.service.test.ts
git commit -m "feat(categories): add PATCH /categories/:id, protect Da classificare from rename"
```

---

## Task 5: Eliminazione di una categoria (`remove`, `DELETE /categories/:id`)

**Files:**
- Modify: `apps/backend/src/modules/categories/categories.repository.ts`
- Modify: `apps/backend/src/modules/categories/categories.service.ts`
- Modify: `apps/backend/src/modules/categories/categories.routes.ts`
- Test: `apps/backend/src/modules/categories/categories.service.test.ts`

**Interfaces:**
- Consumes: `atomically` da `../../db/client.js`; `FALLBACK_CATEGORY_ID`, `requireCategory` (Task 3).
- Produces: `categoriesRepository.reassignMerchants(fromId: string, toId: string): void`, `categoriesRepository.remove(id: string): void`; `categoriesService.remove(id: string): void` — lancia `NotFoundError` per id inesistente, `ConflictError` per "Da classificare".

- [ ] **Step 1: Scrivi i test falliti**

Aggiungi a `apps/backend/src/modules/categories/categories.service.test.ts`:

```ts
describe('eliminazione di una categoria', () => {
  it('elimina una categoria senza merchant assegnati', () => {
    const categoria = categoriesService.create({ name: 'Da eliminare', color: null });

    categoriesService.remove(categoria.id);

    assert.equal(categoriesService.findById(categoria.id), null);
  });

  it('riassegna a «Da classificare» i merchant della categoria eliminata', () => {
    const categoria = categoriesService.create({ name: 'Con merchant da riassegnare', color: null });
    importService.importCsv(
      ['Data contabile,Descrizione,Importo', '02/05/2026,ESERCENTE RIASSEGNATO,-5.00'].join('\r\n'),
    );
    const merchant = merchantsService.listAll().find((m) => m.name === 'ESERCENTE RIASSEGNATO');
    assert.ok(merchant);
    merchantsService.assignCategory(merchant.id, categoria.id);

    categoriesService.remove(categoria.id);

    const aggiornato = merchantsService.listAll().find((m) => m.id === merchant.id);
    assert.equal(aggiornato?.categoryId, FALLBACK_CATEGORY_ID);
    assert.equal(categoriesService.findById(categoria.id), null);
  });

  it('non permette di eliminare «Da classificare»', () => {
    assert.throws(
      () => categoriesService.remove(FALLBACK_CATEGORY_ID),
      (error: unknown) => {
        assert.ok(error instanceof ConflictError);
        return true;
      },
    );
  });

  it('lancia NotFoundError per un id inesistente', () => {
    assert.throws(
      () => categoriesService.remove('id-che-non-esiste'),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundError);
        return true;
      },
    );
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `npx tsx --test apps/backend/src/modules/categories/categories.service.test.ts`
Expected: FAIL — `categoriesService.remove` non esiste.

- [ ] **Step 3: Aggiungi `reassignMerchants` e `remove` al repository**

Modifica `apps/backend/src/modules/categories/categories.repository.ts`, aggiungi dentro l'oggetto `categoriesRepository` (dopo `update`):

```ts
  remove(id: string): void {
    db.delete(categories).where(eq(categories.id, id)).run();
  },

  /** Sposta tutti i merchant di `fromId` su `toId`. */
  reassignMerchants(fromId: string, toId: string): void {
    db.update(merchants).set({ categoryId: toId }).where(eq(merchants.categoryId, fromId)).run();
  },
```

- [ ] **Step 4: Aggiungi `remove` al service**

Modifica `apps/backend/src/modules/categories/categories.service.ts`: aggiungi l'import di `atomically` e il metodo.

```ts
import { atomically } from '../../db/client.js';
```

```ts
  remove(id: string): void {
    requireCategory(id);

    if (id === FALLBACK_CATEGORY_ID) {
      throw new ConflictError('«Da classificare» non può essere eliminata.');
    }

    atomically(() => {
      categoriesRepository.reassignMerchants(id, FALLBACK_CATEGORY_ID);
      categoriesRepository.remove(id);
    });
  },
```

- [ ] **Step 5: Aggiungi la route DELETE**

Modifica `apps/backend/src/modules/categories/categories.routes.ts`:

```ts
// DELETE /categories/:id
categoriesRouter.delete('/:id', (req, res) => {
  const id = categoryId(req.params.id);

  categoriesService.remove(id);

  res.status(204).send();
});
```

- [ ] **Step 6: Esegui il test e verifica che passi**

Run: `npx tsx --test apps/backend/src/modules/categories/categories.service.test.ts`
Expected: PASS (19 test)

- [ ] **Step 7: Verifica il typecheck**

Run: `npx tsc -p apps/backend/tsconfig.json --noEmit`
Expected: nessun errore

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/modules/categories/categories.repository.ts apps/backend/src/modules/categories/categories.service.ts apps/backend/src/modules/categories/categories.routes.ts apps/backend/src/modules/categories/categories.service.test.ts
git commit -m "feat(categories): add DELETE /categories/:id with atomic merchant reassignment"
```

---

## Task 6: Aggiorna `index.ts` della feature categories

**Files:**
- Modify: `apps/backend/src/modules/categories/index.ts`

**Interfaces:**
- Consumes: tutti i simboli prodotti nei Task 1-5.
- Produces: superficie pubblica completa della feature, usata dal Task 7 (reset) e da eventuali altri moduli.

- [ ] **Step 1: Aggiorna le esportazioni**

Sostituisci il contenuto di `apps/backend/src/modules/categories/index.ts`:

```ts
/** API pubblica della feature `categories`. */
export type { Category, CategoryWithUsage, NewCategory } from './category.model.js';
export { categoriesService, FALLBACK_CATEGORY_ID } from './categories.service.js';
export {
  toCategoryDto,
  type CategoryDto,
  toCategoryWithUsageDto,
  type CategoryWithUsageDto,
} from './categories.dto.js';
export { categoriesRouter } from './categories.routes.js';
```

- [ ] **Step 2: Verifica il typecheck**

Run: `npx tsc -p apps/backend/tsconfig.json --noEmit`
Expected: nessun errore

- [ ] **Step 3: Esegui l'intera suite backend per verificare che nulla si sia rotto**

Run: `npx tsx --test "apps/backend/src/**/*.test.ts"`
Expected: PASS su tutti i file (i test di `reset.service.test.ts` e `maintenance.routes.test.ts` falliranno ancora finché non arrivi al Task 7 — è atteso a questo punto del piano)

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/modules/categories/index.ts
git commit -m "feat(categories): export FALLBACK_CATEGORY_ID and usage DTOs from the public API"
```

---

## Task 7: Il reset dell'archivio non tocca più le categorie

**Files:**
- Modify: `apps/backend/src/modules/maintenance/reset.service.ts`
- Modify: `apps/backend/src/modules/maintenance/reset.service.test.ts`
- Modify: `apps/backend/src/modules/maintenance/maintenance.routes.test.ts`

**Interfaces:**
- Consumes: `categoriesService.create`, `categoriesService.listAll` (Task 1, esistente).
- Produces: `userTables()` non include più `'categories'`; `ResetOutcome` non ha più il campo `seededCategories`.

- [ ] **Step 1: Modifica `userTables()` e rimuovi il reinserimento del seed**

In `apps/backend/src/modules/maintenance/reset.service.ts`, rimuovi la riga:

```ts
import { CATEGORY_SEED } from '../categories/categories.seed.js';
```

Sostituisci la funzione `userTables`:

```ts
/**
 * Le tabelle dei dati dell'utente, chieste al database.
 *
 * Chieste e non elencate a mano: un elenco scritto qui resterebbe indietro alla
 * prima tabella aggiunta, e un azzeramento che dimentica una tabella è un
 * guasto silenzioso — l'utente crede di essere ripartito da zero e non lo è.
 *
 * Le tabelle di servizio sono escluse con la stessa regola usata dal manifest
 * dei backup: il doppio trattino basso non è un dato dell'utente. È anche ciò
 * che protegge `__drizzle_migrations`, cioè la versione dello schema.
 *
 * `categories` è l'unica eccezione elencata a mano: da quando è gestita a
 * runtime (creazione, modifica, eliminazione dall'utente) non è più un dato da
 * azzerare, ma configurazione stabile — allo stesso titolo dello schema.
 */
export function userTables(): string[] {
  const rows = db.all<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`,
  );

  return rows
    .map((row) => row.name)
    .filter((name) => !name.startsWith('__'))
    .filter((name) => name !== 'categories');
}
```

Nel corpo di `resetService.run()`, rimuovi il blocco che reinserisce `CATEGORY_SEED`:

```ts
      for (const category of CATEGORY_SEED) {
        db.run(
          sql`insert into categories (id, name, color) values (${category.id}, ${category.name}, ${category.color})`,
        );
      }

```

(elimina queste righe, lasciando `PRAGMA defer_foreign_keys`, il ciclo `delete from`, e l'insert di `settings` che segue)

Aggiorna `ResetOutcome`, rimuovendo `seededCategories`:

```ts
export interface ResetOutcome {
  /** Il backup creato prima di procedere: da lì si torna indietro. */
  readonly backupName: string;
  /** Quante righe sono state eliminate, per tabella. */
  readonly removed: Record<string, number>;
}
```

Aggiorna il `return` finale di `run()`:

```ts
    return { backupName, removed };
```

Aggiorna anche il commento in testa al file (blocco `/** Azzerare l'archivio... */`), sostituendo la frase "le ventidue categorie iniziali e l'unica riga delle impostazioni" con "l'unica riga delle impostazioni" nella sezione "Cosa torna come al primo avvio", e aggiungendo una riga alla sezione "Cosa resta" che menzioni le categorie:

```
 * ## Cosa resta
 *
 * Lo **schema** e il registro delle migrazioni: azzerare i dati non è tornare
 * a una versione precedente del programma, e riapplicare le migrazioni non
 * avrebbe senso. I **backup** restano tutti dove sono — compreso quello appena
 * creato, che la ritenzione non elimina mai. I **log** restano: raccontano
 * anche questo azzeramento. Le **categorie** restano, incluse quelle create o
 * modificate dall'utente: da quando sono gestite a runtime non sono più un
 * dato da riportare al primo avvio.
 *
 * ## Cosa torna come al primo avvio
 *
 * Ogni tabella dell'applicazione (categorie escluse) viene svuotata, e le
 * righe che una installazione nuova ha vengono reinserite: l'unica riga delle
 * impostazioni, con saldo di partenza sconosciuto.
```

- [ ] **Step 2: Aggiorna `reset.service.test.ts`**

Rimuovi la riga:

```ts
const { CATEGORY_SEED } = await import('../categories/categories.seed.js');
```

Nella funzione `contiDiUnArchivioNuovo`, aggiungi il filtro che esclude `categories`:

```ts
    const tabelle = nuovo
      .all<{ name: string }>(
        sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`,
      )
      .map((row) => row.name)
      .filter((name) => !name.startsWith('__'))
      .filter((name) => name !== 'categories');
```

Nella funzione `contiAttuali`, rimuovi la chiave `categories`:

```ts
function contiAttuali(): Record<string, number> {
  const prestiti = loansService.list(DEFAULT_LOAN_QUERY).items;

  return {
    loan_repayments: prestiti.reduce((totale, prestito) => totale + prestito.repaymentCount, 0),
    loans: prestiti.length,
    merchants: merchantsService.listAllWithCategory().length,
    // Riga unica, con identificativo fisso: c'è sempre, e sempre una sola.
    settings: 1,
    transactions: transactionsService.listAll().length,
  };
}
```

Nella funzione `riempi`, aggiungi la creazione di una categoria custom, alla fine (dopo `settingsService.update(...)`):

```ts
  categoriesService.create({ name: 'Categoria di prova', color: '#123456' });
```

Nel blocco `describe('le tabelle da svuotare', ...)`, sostituisci l'intero test:

```ts
describe('le tabelle da svuotare', () => {
  it('vengono chieste al database, e non comprendono quelle di servizio né le categorie', () => {
    const tabelle = userTables();

    assert.ok(tabelle.includes('transactions'));
    assert.ok(tabelle.includes('merchants'));
    assert.ok(tabelle.includes('loans'));
    assert.ok(tabelle.includes('loan_repayments'));
    assert.ok(tabelle.includes('settings'));
    // Il registro delle migrazioni non è un dato dell'utente: azzerare i dati
    // non è tornare a una versione precedente del programma.
    assert.ok(!tabelle.some((nome) => nome.startsWith('__')));
    // Le categorie sono configurazione stabile gestita a runtime, non dato
    // utente: il reset non le tocca.
    assert.ok(!tabelle.includes('categories'));
  });
});
```

Nel test `'riporta l-archivio allo stato di uno appena creato'`, rimuovi la riga:

```ts
    assert.equal(esito.seededCategories, CATEGORY_SEED.length);
```

Sostituisci interamente il test `'le categorie iniziali sono quelle del seed, con gli stessi identificativi'`:

```ts
  it('le categorie, incluse quelle create dall-utente, sopravvivono all-azzeramento', () => {
    const categorie = categoriesService.listAll();

    // La categoria di prova creata da riempi() prima del reset è ancora qui.
    assert.ok(categorie.some((categoria) => categoria.name === 'Categoria di prova'));
    // E le ventiquattro del seed di partenza ci sono ancora tutte.
    assert.ok(categorie.length >= 25);
  });
```

Nel test `'su un archivio già vuoto non fallisce'`, rimuovi la riga:

```ts
    // Le categorie c'erano — quelle del seed — e vengono rimesse.
    assert.equal(esito.removed.categories, CATEGORY_SEED.length);
```

- [ ] **Step 3: Aggiorna `maintenance.routes.test.ts`**

Nel test `'con la conferma azzera, e dice da dove si torna indietro'`, rimuovi `seededCategories: number;` dal tipo del corpo e rimuovi la riga di asserzione:

```ts
    const corpo = JSON.parse(risposta.body) as {
      backupName: string;
      removed: Record<string, number>;
      message: string;
    };

    assert.match(corpo.backupName, /^pre-reset-\d{8}-\d{6}\.sqlite$/);
    assert.equal(corpo.removed.transactions, primaTransazioni);
```

(rimossa la riga `assert.equal(corpo.seededCategories, 24);`)

- [ ] **Step 4: Esegui i due file di test e verifica che passino**

Run: `npx tsx --test apps/backend/src/modules/maintenance/reset.service.test.ts apps/backend/src/modules/maintenance/maintenance.routes.test.ts`
Expected: PASS su entrambi

- [ ] **Step 5: Verifica il typecheck**

Run: `npx tsc -p apps/backend/tsconfig.json --noEmit`
Expected: nessun errore (finché `categories.seed.ts` non è ancora stato eliminato — il Task 8 lo rimuove, a questo punto potrebbe restare come file orfano non importato da nessuno: va bene, non causa errori di tipo)

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/modules/maintenance/reset.service.ts apps/backend/src/modules/maintenance/reset.service.test.ts apps/backend/src/modules/maintenance/maintenance.routes.test.ts
git commit -m "feat(maintenance): exclude categories from archive reset"
```

---

## Task 8: Elimina il doppio seed (file TypeScript e relativo test)

**Files:**
- Delete: `apps/backend/src/modules/categories/categories.seed.ts`
- Delete: `apps/backend/src/modules/categories/categories.seed.test.ts`

**Interfaces:**
- Consumes: nessuno (dopo il Task 7, nessun file di produzione importa più `categories.seed.ts`).

- [ ] **Step 1: Verifica che nessun file importi ancora `categories.seed.ts`**

Run: `grep -rn "categories.seed" apps/backend/src --include="*.ts"`
Expected: nessun risultato (a parte, se presenti, i due file che stai per eliminare)

- [ ] **Step 2: Elimina i due file**

```bash
git rm apps/backend/src/modules/categories/categories.seed.ts apps/backend/src/modules/categories/categories.seed.test.ts
```

- [ ] **Step 3: Esegui l'intera suite di test backend**

Run: `npx tsx --test "apps/backend/src/**/*.test.ts"`
Expected: PASS su tutti i file

- [ ] **Step 4: Verifica il typecheck**

Run: `npx tsc -p apps/backend/tsconfig.json --noEmit`
Expected: nessun errore

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor(categories): remove the TypeScript seed duplicate

The SQL migration remains the only source for the initial bootstrap.
Categories are now managed at runtime through the CRUD API, so there is
nothing left to keep in sync between two files.
EOF
)"
```

---

## Task 9: Frontend — modello e API service delle categorie

**Files:**
- Modify: `apps/frontend/src/app/features/categories/category.model.ts`
- Modify: `apps/frontend/src/app/features/categories/categories.api.ts`

**Interfaces:**
- Produces: `CategoryWithUsage` (`Category & { merchantCount: number }`) in `category.model.ts`; `NewCategory`, `CategoryPatch` e i metodi `create`, `update`, `delete` in `categories.api.ts`. `list()` ora tipizzato `Observable<CategoryWithUsage[]>` (compatibile con l'uso esistente in `merchants-page.ts`/`transactions-page.ts`, che leggono `Category[]` — `CategoryWithUsage[]` è strutturalmente assegnabile).
- Consumato da: Task 10 (pagina categorie).

Questo task non ha test propri: `categories.api.ts` è un thin wrapper su `HttpClient`, coerente con `merchants.api.ts` (nessun file `*.api.spec.ts` nel progetto) — il suo comportamento viene esercitato dai test della pagina nei Task 10-12 tramite `HttpTestingController`.

- [ ] **Step 1: Aggiungi `CategoryWithUsage` al modello**

Modifica `apps/frontend/src/app/features/categories/category.model.ts`:

```ts
/** Categoria di spesa, così come viene esposta dalle API del backend. */
export interface Category {
  id: string;
  name: string;
  color: string | null;
}

/** Categoria con il numero di merchant attualmente assegnati. */
export interface CategoryWithUsage extends Category {
  merchantCount: number;
}
```

- [ ] **Step 2: Estendi il service API**

Sostituisci il contenuto di `apps/frontend/src/app/features/categories/categories.api.ts`:

```ts
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/api';
import { Category, CategoryWithUsage } from './category.model';

export interface NewCategory {
  name: string;
  color: string | null;
}

export interface CategoryPatch {
  name?: string;
  color?: string | null;
}

@Injectable({ providedIn: 'root' })
export class CategoriesApi {
  private readonly http = inject(HttpClient);

  /** Tutte le categorie, con il numero di merchant assegnati a ciascuna. */
  list(): Observable<CategoryWithUsage[]> {
    return this.http.get<CategoryWithUsage[]>(`${API_BASE_URL}/categories`);
  }

  create(category: NewCategory): Observable<Category> {
    return this.http.post<Category>(`${API_BASE_URL}/categories`, category);
  }

  update(id: string, patch: CategoryPatch): Observable<CategoryWithUsage> {
    return this.http.patch<CategoryWithUsage>(`${API_BASE_URL}/categories/${id}`, patch);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/categories/${id}`);
  }
}
```

- [ ] **Step 3: Verifica che il frontend compili**

Run: `npm run build --prefix apps/frontend`
Expected: build riuscita, nessun errore TypeScript

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/app/features/categories/category.model.ts apps/frontend/src/app/features/categories/categories.api.ts
git commit -m "feat(categories): add create/update/delete to the frontend API service"
```

---

## Task 10: Frontend — pagina categorie, lista base e routing

**Files:**
- Create: `apps/frontend/src/app/features/categories/categories-page.ts`
- Create: `apps/frontend/src/app/features/categories/categories-page.html`
- Create: `apps/frontend/src/app/features/categories/categories-page.scss`
- Create: `apps/frontend/src/app/features/categories/categories-page.spec.ts`
- Modify: `apps/frontend/src/app/app.routes.ts`
- Modify: `apps/frontend/src/app/app.html`

**Interfaces:**
- Consumes: `CategoriesApi.list()` (Task 9), `Panel`, `SectionHeader` (`shared/layout/`), `toErrorMessage` (`core/http-error.ts`).
- Produces: componente `CategoriesPage`, con `protected readonly categories`, `loading`, `error` come signal — consumati/estesi dai Task 11-12.

- [ ] **Step 1: Scrivi il test fallente per il caricamento della lista**

Crea `apps/frontend/src/app/features/categories/categories-page.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../core/api';
import { CategoriesPage } from './categories-page';
import { CategoryWithUsage } from './category.model';

describe('CategoriesPage', () => {
  let http: HttpTestingController;

  const category = (overrides: Partial<CategoryWithUsage> = {}): CategoryWithUsage => ({
    id: 'c-1',
    name: 'Alimentari',
    color: '#3f8f4f',
    merchantCount: 0,
    ...overrides
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('carica e mostra le categorie', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    fixture.detectChanges();

    http.expectOne(`${API_BASE_URL}/categories`).flush([category(), category({ id: 'c-2', name: 'Casa' })]);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Alimentari');
    expect(text).toContain('Casa');
  });

  it('mostra il numero di merchant assegnati', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    fixture.detectChanges();

    http.expectOne(`${API_BASE_URL}/categories`).flush([category({ merchantCount: 3 })]);
    fixture.detectChanges();

    expect((fixture.nativeElement.textContent as string)).toContain('3');
  });

  it('mostra un messaggio di errore se il caricamento fallisce', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    fixture.detectChanges();

    http.expectOne(`${API_BASE_URL}/categories`).flush('errore', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect((fixture.nativeElement.textContent as string)).toContain('Si è verificato un errore imprevisto.');
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `npm test --prefix apps/frontend -- --watch=false apps/frontend/src/app/features/categories/categories-page.spec.ts`
Expected: FAIL — `CategoriesPage` non esiste ancora.

- [ ] **Step 3: Crea il componente**

Crea `apps/frontend/src/app/features/categories/categories-page.ts`:

```ts
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toErrorMessage } from '../../core/http-error';
import { Panel } from '../../shared/layout/panel';
import { SectionHeader } from '../../shared/layout/section-header';
import { CategoriesApi } from './categories.api';
import { CategoryWithUsage } from './category.model';

/**
 * L'id fisso di "Da classificare": non rinominabile né eliminabile.
 *
 * Duplicato rispetto a `FALLBACK_CATEGORY_ID` nel backend
 * (`categories.service.ts`) perché il progetto non condivide codice fra le
 * due app.
 */
const FALLBACK_CATEGORY_ID = 'c9bfcd74-e342-4a3f-8b0c-116f89236d51';

/**
 * Gestione delle categorie di spesa.
 *
 * Crea, rinomina, ricolora ed elimina: le categorie sono configurazione a
 * runtime, non più un elenco fisso deciso al primo avvio.
 */
@Component({
  selector: 'app-categories-page',
  imports: [FormsModule, Panel, SectionHeader],
  templateUrl: './categories-page.html',
  styleUrl: './categories-page.scss'
})
export class CategoriesPage implements OnInit {
  private readonly api = inject(CategoriesApi);

  protected readonly categories = signal<CategoryWithUsage[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.api.list().subscribe({
      next: (categories) => {
        this.categories.set(categories);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(toErrorMessage(error));
        this.loading.set(false);
      }
    });
  }

  protected isProtected(id: string): boolean {
    return id === FALLBACK_CATEGORY_ID;
  }
}
```

- [ ] **Step 4: Crea il template**

Crea `apps/frontend/src/app/features/categories/categories-page.html`:

```html
<app-panel>
  <app-section-header
    title="Categorie"
    subtitle="Crea, rinomina o elimina le categorie di spesa."
  >
    <button panelActions type="button" (click)="load()" [disabled]="loading()">Aggiorna</button>
  </app-section-header>

  @if (error(); as message) {
    <p class="message error">{{ message }}</p>
  }

  @if (loading()) {
    <p class="message">Caricamento in corso…</p>
  } @else if (categories().length === 0) {
    <p class="message">Nessuna categoria.</p>
  } @else {
    <table class="categories">
      <thead>
        <tr>
          <th scope="col">Nome</th>
          <th scope="col">Colore</th>
          <th scope="col" class="numeric">Merchant assegnati</th>
        </tr>
      </thead>
      <tbody>
        @for (category of categories(); track category.id) {
          <tr>
            <td class="name">{{ category.name }}</td>
            <td class="color">
              <span class="swatch" [style.background]="category.color ?? 'var(--text-muted)'"></span>
            </td>
            <td class="numeric">{{ category.merchantCount }}</td>
          </tr>
        }
      </tbody>
    </table>
  }
</app-panel>
```

- [ ] **Step 5: Crea lo stile**

Crea `apps/frontend/src/app/features/categories/categories-page.scss`:

```scss
.message {
  color: var(--text-muted);
}

.message.error {
  color: var(--negative);
}

.categories {
  width: 100%;
  border-collapse: collapse;
  margin-top: 1rem;

  th,
  td {
    text-align: left;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }

  th {
    font-size: 0.8125rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
  }

  .numeric {
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .swatch {
    display: inline-block;
    width: 1rem;
    height: 1rem;
    border-radius: 4px;
    border: 1px solid var(--border);
  }
}
```

- [ ] **Step 6: Aggiungi la route**

Modifica `apps/frontend/src/app/app.routes.ts`: aggiungi l'import e la voce di route, tra `merchants` e `import`.

```ts
import { CategoriesPage } from './features/categories/categories-page';
```

```ts
  {
    path: 'categories',
    component: CategoriesPage,
    title: 'Categorie'
  },
```

(inserisci questo blocco tra la voce `merchants` e la voce `import` nell'array `routes`)

- [ ] **Step 7: Aggiungi il link nel menu**

Modifica `apps/frontend/src/app/app.html`, aggiungendo il link tra "Merchant" e "Import CSV":

```html
    <a routerLink="/categories" routerLinkActive="active">Categorie</a>
```

- [ ] **Step 8: Esegui il test e verifica che passi**

Run: `npm test --prefix apps/frontend -- --watch=false apps/frontend/src/app/features/categories/categories-page.spec.ts`
Expected: PASS (3 test)

- [ ] **Step 9: Verifica che il frontend compili**

Run: `npm run build --prefix apps/frontend`
Expected: build riuscita

- [ ] **Step 10: Commit**

```bash
git add apps/frontend/src/app/features/categories/categories-page.ts apps/frontend/src/app/features/categories/categories-page.html apps/frontend/src/app/features/categories/categories-page.scss apps/frontend/src/app/features/categories/categories-page.spec.ts apps/frontend/src/app/app.routes.ts apps/frontend/src/app/app.html
git commit -m "feat(categories): add categories management page (list view)"
```

---

## Task 11: Frontend — creazione e modifica inline

**Files:**
- Modify: `apps/frontend/src/app/features/categories/categories-page.ts`
- Modify: `apps/frontend/src/app/features/categories/categories-page.html`
- Modify: `apps/frontend/src/app/features/categories/categories-page.scss`
- Modify: `apps/frontend/src/app/features/categories/categories-page.spec.ts`

**Interfaces:**
- Consumes: `CategoriesApi.create`, `CategoriesApi.update` (Task 9); `isProtected` (Task 10).
- Produces: `create(event)`, `rename(category, value)`, `recolor(category, value)` sul componente — usati anche dal Task 12 per il pattern di stato condiviso (`savingId`).

- [ ] **Step 1: Scrivi i test falliti**

Aggiungi a `apps/frontend/src/app/features/categories/categories-page.spec.ts`, dentro `describe('CategoriesPage', ...)`, dopo i test esistenti:

```ts
  const load = (fixture: ReturnType<typeof TestBed.createComponent>, categories: CategoryWithUsage[] = []): void => {
    fixture.detectChanges();
    http.expectOne(`${API_BASE_URL}/categories`).flush(categories);
    fixture.detectChanges();
  };

  it('crea una nuova categoria dal form', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture);

    const nameInput = fixture.nativeElement.querySelector('input[name="newName"]') as HTMLInputElement;
    nameInput.value = 'Regali';
    nameInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { cancelable: true })
    );
    fixture.detectChanges();

    const request = http.expectOne(`${API_BASE_URL}/categories`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body.name).toBe('Regali');
    request.flush({ id: 'c-new', name: 'Regali', color: '#9aa3af' });
    fixture.detectChanges();

    expect((fixture.nativeElement.textContent as string)).toContain('Regali');
  });

  it('mostra un errore se il nome è già in uso', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture);

    const nameInput = fixture.nativeElement.querySelector('input[name="newName"]') as HTMLInputElement;
    nameInput.value = 'Doppione';
    nameInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { cancelable: true })
    );

    http
      .expectOne(`${API_BASE_URL}/categories`)
      .flush({ error: 'Esiste già una categoria con il nome "Doppione".' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();

    expect((fixture.nativeElement.textContent as string)).toContain(
      'Esiste già una categoria con il nome "Doppione".'
    );
  });

  it('rinomina una categoria esistente', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture, [category()]);

    const nameInput = fixture.nativeElement.querySelector('input.rename') as HTMLInputElement;
    nameInput.value = 'Spesa alimentare';
    nameInput.dispatchEvent(new Event('change'));

    const request = http.expectOne(`${API_BASE_URL}/categories/c-1`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ name: 'Spesa alimentare' });
    request.flush(category({ name: 'Spesa alimentare' }));
    fixture.detectChanges();

    expect((fixture.nativeElement.textContent as string)).toContain('Spesa alimentare');
  });

  it('non permette di rinominare «Da classificare»', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture, [category({ id: 'c9bfcd74-e342-4a3f-8b0c-116f89236d51', name: 'Da classificare' })]);

    expect(fixture.nativeElement.querySelector('input.rename')).toBeNull();
  });
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `npm test --prefix apps/frontend -- --watch=false apps/frontend/src/app/features/categories/categories-page.spec.ts`
Expected: FAIL — mancano il form e gli input di rinomina/colore.

- [ ] **Step 3: Estendi il componente**

Modifica `apps/frontend/src/app/features/categories/categories-page.ts`: aggiungi i signal e i metodi.

```ts
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toErrorMessage } from '../../core/http-error';
import { Panel } from '../../shared/layout/panel';
import { SectionHeader } from '../../shared/layout/section-header';
import { CategoriesApi } from './categories.api';
import { CategoryWithUsage } from './category.model';

const FALLBACK_CATEGORY_ID = 'c9bfcd74-e342-4a3f-8b0c-116f89236d51';

@Component({
  selector: 'app-categories-page',
  imports: [FormsModule, Panel, SectionHeader],
  templateUrl: './categories-page.html',
  styleUrl: './categories-page.scss'
})
export class CategoriesPage implements OnInit {
  private readonly api = inject(CategoriesApi);

  protected readonly categories = signal<CategoryWithUsage[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly newName = signal('');
  protected readonly newColor = signal('#9aa3af');
  protected readonly creating = signal(false);
  protected readonly createError = signal<string | null>(null);

  protected readonly savingId = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.api.list().subscribe({
      next: (categories) => {
        this.categories.set(categories);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(toErrorMessage(error));
        this.loading.set(false);
      }
    });
  }

  protected isProtected(id: string): boolean {
    return id === FALLBACK_CATEGORY_ID;
  }

  protected create(event: Event): void {
    event.preventDefault();
    const name = this.newName().trim();
    if (name === '' || this.creating()) {
      return;
    }

    this.creating.set(true);
    this.createError.set(null);

    this.api.create({ name, color: this.newColor() }).subscribe({
      next: (created) => {
        this.categories.update((categories) => [...categories, { ...created, merchantCount: 0 }]);
        this.newName.set('');
        this.newColor.set('#9aa3af');
        this.creating.set(false);
      },
      error: (error: unknown) => {
        this.createError.set(toErrorMessage(error));
        this.creating.set(false);
      }
    });
  }

  protected rename(category: CategoryWithUsage, value: string): void {
    const name = value.trim();
    if (name === '' || name === category.name) {
      return;
    }

    this.save(category.id, this.api.update(category.id, { name }));
  }

  protected recolor(category: CategoryWithUsage, value: string): void {
    if (value === category.color) {
      return;
    }

    this.save(category.id, this.api.update(category.id, { color: value }));
  }

  private save(categoryId: string, request: ReturnType<CategoriesApi['update']>): void {
    this.savingId.set(categoryId);
    this.error.set(null);

    request.subscribe({
      next: (updated) => {
        this.categories.update((categories) =>
          categories.map((category) => (category.id === updated.id ? updated : category))
        );
        this.savingId.set(null);
      },
      error: (error: unknown) => {
        this.error.set(toErrorMessage(error));
        this.savingId.set(null);
        this.load();
      }
    });
  }
}
```

- [ ] **Step 4: Estendi il template**

Sostituisci il contenuto di `apps/frontend/src/app/features/categories/categories-page.html`:

```html
<app-panel>
  <app-section-header
    title="Categorie"
    subtitle="Crea, rinomina o elimina le categorie di spesa."
  >
    <button panelActions type="button" (click)="load()" [disabled]="loading()">Aggiorna</button>
  </app-section-header>

  @if (error(); as message) {
    <p class="message error">{{ message }}</p>
  }

  <form class="create-form" (submit)="create($event)">
    <input
      type="text"
      name="newName"
      placeholder="Nome nuova categoria"
      [ngModel]="newName()"
      (ngModelChange)="newName.set($event)"
      [disabled]="creating()"
    />
    <input
      type="color"
      name="newColor"
      [ngModel]="newColor()"
      (ngModelChange)="newColor.set($event)"
      [disabled]="creating()"
    />
    <button type="submit" [disabled]="creating() || newName().trim() === ''">
      {{ creating() ? 'Creazione…' : 'Aggiungi categoria' }}
    </button>
  </form>

  @if (createError(); as message) {
    <p class="message error">{{ message }}</p>
  }

  @if (loading()) {
    <p class="message">Caricamento in corso…</p>
  } @else if (categories().length === 0) {
    <p class="message">Nessuna categoria.</p>
  } @else {
    <table class="categories">
      <thead>
        <tr>
          <th scope="col">Nome</th>
          <th scope="col">Colore</th>
          <th scope="col" class="numeric">Merchant assegnati</th>
        </tr>
      </thead>
      <tbody>
        @for (category of categories(); track category.id) {
          <tr [class.saving]="savingId() === category.id">
            <td class="name">
              @if (isProtected(category.id)) {
                {{ category.name }}
              } @else {
                <input
                  type="text"
                  class="rename"
                  [value]="category.name"
                  [disabled]="savingId() === category.id"
                  [attr.aria-label]="'Nome di ' + category.name"
                  (change)="rename(category, $any($event.target).value)"
                />
              }
            </td>
            <td class="color">
              <input
                type="color"
                [value]="category.color ?? '#9aa3af'"
                [disabled]="savingId() === category.id"
                [attr.aria-label]="'Colore di ' + category.name"
                (change)="recolor(category, $any($event.target).value)"
              />
            </td>
            <td class="numeric">{{ category.merchantCount }}</td>
          </tr>
        }
      </tbody>
    </table>
  }
</app-panel>
```

- [ ] **Step 5: Estendi lo stile**

Aggiungi a `apps/frontend/src/app/features/categories/categories-page.scss`:

```scss
.create-form {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 1.5rem 0 1rem;

  input[type='text'] {
    flex: 1;
    max-width: 20rem;
    padding: 0.4375rem 0.625rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
  }

  input[type='color'] {
    width: 2.5rem;
    height: 2rem;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
  }

  button {
    padding: 0.4375rem 0.75rem;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: var(--accent);
    color: var(--on-accent, #fff);
  }
}

.categories {
  .name input.rename {
    font: inherit;
    width: 100%;
    padding: 0.25rem 0.375rem;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: var(--text);
  }

  .name input.rename:hover:not(:disabled),
  .name input.rename:focus {
    border-color: var(--border);
    background: var(--surface);
  }

  .color input[type='color'] {
    width: 2rem;
    height: 1.5rem;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
  }

  tr.saving {
    opacity: 0.6;
  }
}
```

(rimuovi la regola `.swatch` aggiunta nel Task 10, ora sostituita dall'`<input type="color">`)

- [ ] **Step 6: Esegui il test e verifica che passi**

Run: `npm test --prefix apps/frontend -- --watch=false apps/frontend/src/app/features/categories/categories-page.spec.ts`
Expected: PASS (7 test)

- [ ] **Step 7: Verifica che il frontend compili**

Run: `npm run build --prefix apps/frontend`
Expected: build riuscita

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/app/features/categories/categories-page.ts apps/frontend/src/app/features/categories/categories-page.html apps/frontend/src/app/features/categories/categories-page.scss apps/frontend/src/app/features/categories/categories-page.spec.ts
git commit -m "feat(categories): add creation form and inline rename/recolor"
```

---

## Task 12: Frontend — eliminazione con conferma a due passi

**Files:**
- Modify: `apps/frontend/src/app/features/categories/categories-page.ts`
- Modify: `apps/frontend/src/app/features/categories/categories-page.html`
- Modify: `apps/frontend/src/app/features/categories/categories-page.scss`
- Modify: `apps/frontend/src/app/features/categories/categories-page.spec.ts`

**Interfaces:**
- Consumes: `CategoriesApi.delete` (Task 9); `isProtected`, `savingId` pattern (Task 10-11).
- Produces: `askDelete(id)`, `cancelDelete()`, `deleteCategory(category)`, signal `confirmingDeleteId`, `deleting` — completa il componente `CategoriesPage`.

- [ ] **Step 1: Scrivi i test falliti**

Aggiungi a `apps/frontend/src/app/features/categories/categories-page.spec.ts`, dopo i test del Task 11:

```ts
  it('chiede conferma prima di eliminare, mostrando quanti merchant verranno riassegnati', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture, [category({ merchantCount: 3 })]);

    (fixture.nativeElement.querySelector('button.danger') as HTMLButtonElement).click();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('3');
    expect(fixture.nativeElement.querySelector('button.confirm-delete')).not.toBeNull();
    http.expectNone(`${API_BASE_URL}/categories/c-1`);
  });

  it('elimina la categoria alla conferma', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture, [category()]);

    (fixture.nativeElement.querySelector('button.danger') as HTMLButtonElement).click();
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('button.confirm-delete') as HTMLButtonElement).click();

    const request = http.expectOne(`${API_BASE_URL}/categories/c-1`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    fixture.detectChanges();

    expect((fixture.nativeElement.textContent as string)).not.toContain('Alimentari');
  });

  it('annulla senza eliminare', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture, [category()]);

    (fixture.nativeElement.querySelector('button.danger') as HTMLButtonElement).click();
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('button.ghost') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('button.confirm-delete')).toBeNull();
    http.expectNone(`${API_BASE_URL}/categories/c-1`);
  });

  it('non permette di eliminare «Da classificare»', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture, [category({ id: 'c9bfcd74-e342-4a3f-8b0c-116f89236d51', name: 'Da classificare' })]);

    expect(fixture.nativeElement.querySelector('button.danger')).toBeNull();
  });
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `npm test --prefix apps/frontend -- --watch=false apps/frontend/src/app/features/categories/categories-page.spec.ts`
Expected: FAIL — mancano i bottoni di eliminazione/conferma.

- [ ] **Step 3: Estendi il componente**

Modifica `apps/frontend/src/app/features/categories/categories-page.ts`: aggiungi i signal e i metodi (dopo `save`, prima della chiusura della classe).

```ts
  protected readonly confirmingDeleteId = signal<string | null>(null);
  protected readonly deleting = signal(false);
```

(aggiungi questi due signal accanto agli altri, dopo `savingId`)

```ts
  protected askDelete(id: string): void {
    this.error.set(null);
    this.confirmingDeleteId.set(id);
  }

  protected cancelDelete(): void {
    this.confirmingDeleteId.set(null);
  }

  protected deleteCategory(category: CategoryWithUsage): void {
    this.deleting.set(true);
    this.error.set(null);

    this.api.delete(category.id).subscribe({
      next: () => {
        this.categories.update((categories) => categories.filter((c) => c.id !== category.id));
        this.deleting.set(false);
        this.confirmingDeleteId.set(null);
      },
      error: (error: unknown) => {
        this.error.set(toErrorMessage(error));
        this.deleting.set(false);
        this.confirmingDeleteId.set(null);
      }
    });
  }
```

- [ ] **Step 4: Estendi il template**

Modifica `apps/frontend/src/app/features/categories/categories-page.html`: aggiungi una colonna azioni alla tabella.

Nel `<thead>`, dopo `<th scope="col" class="numeric">Merchant assegnati</th>`:

```html
          <th scope="col"></th>
```

Nel `<tbody>`, dopo `<td class="numeric">{{ category.merchantCount }}</td>`:

```html
            <td class="actions">
              @if (!isProtected(category.id)) {
                @if (confirmingDeleteId() === category.id) {
                  <span class="ask">
                    {{ category.merchantCount }}
                    {{ category.merchantCount === 1 ? 'merchant verrà spostato' : 'merchant verranno spostati' }}
                    su «Da classificare». Eliminare?
                  </span>
                  <button
                    type="button"
                    class="danger confirm-delete"
                    [disabled]="deleting()"
                    (click)="deleteCategory(category)"
                  >
                    {{ deleting() ? 'Eliminazione…' : 'Sì, elimina' }}
                  </button>
                  <button type="button" class="ghost" [disabled]="deleting()" (click)="cancelDelete()">
                    Annulla
                  </button>
                } @else {
                  <button type="button" class="danger" (click)="askDelete(category.id)">Elimina</button>
                }
              }
            </td>
```

- [ ] **Step 5: Estendi lo stile**

Aggiungi a `apps/frontend/src/app/features/categories/categories-page.scss`:

```scss
.categories {
  .actions {
    white-space: nowrap;
    text-align: right;

    .ask {
      margin-right: 0.5rem;
      color: var(--text-muted);
      font-size: 0.875rem;
    }

    button {
      padding: 0.3125rem 0.625rem;
      border-radius: 6px;
      font-size: 0.875rem;
      margin-left: 0.375rem;
    }

    button.danger {
      border: 1px solid var(--negative);
      background: transparent;
      color: var(--negative);
    }

    button.ghost {
      border: 1px solid var(--border);
      background: transparent;
      color: var(--text-muted);
    }
  }
}
```

- [ ] **Step 6: Esegui il test e verifica che passi**

Run: `npm test --prefix apps/frontend -- --watch=false apps/frontend/src/app/features/categories/categories-page.spec.ts`
Expected: PASS (11 test)

- [ ] **Step 7: Verifica che il frontend compili**

Run: `npm run build --prefix apps/frontend`
Expected: build riuscita

- [ ] **Step 8: Esegui l'intera suite di test frontend, per verificare che nulla si sia rotto altrove**

Run: `npm test --prefix apps/frontend -- --watch=false`
Expected: PASS su tutti i file

- [ ] **Step 9: Esegui l'intera suite di test backend, per una verifica finale end-to-end del piano**

Run: `npx tsx --test "apps/backend/src/**/*.test.ts"`
Expected: PASS su tutti i file

- [ ] **Step 10: Commit**

```bash
git add apps/frontend/src/app/features/categories/categories-page.ts apps/frontend/src/app/features/categories/categories-page.html apps/frontend/src/app/features/categories/categories-page.scss apps/frontend/src/app/features/categories/categories-page.spec.ts
git commit -m "feat(categories): add two-step delete confirmation with merchant reassignment warning"
```
