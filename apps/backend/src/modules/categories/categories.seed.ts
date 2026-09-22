import type { Category } from './category.model.js';

/**
 * Le categorie di partenza.
 *
 * Sono le stesse che la migrazione `0003_seed_categories.sql` inserisce al
 * primo avvio, con gli **stessi identificativi**: quelli sono fissi proprio per
 * essere stabili su ogni installazione, e un merchant che rimandasse a un id
 * diverso dopo un azzeramento perderebbe la propria categoria.
 *
 * Perché esistono qui e non solo nella migrazione: una migrazione viene
 * applicata **una volta sola**, e l'azzeramento dell'archivio deve poter
 * ricostruire questo stato a comando. Rieseguire il file SQL sarebbe
 * un'alternativa, ma legherebbe una funzione dell'applicazione al nome di un
 * file di migrazione e alla capacità di interpretarne il contenuto.
 *
 * Il duplicato è reale, e per questo `categories.seed.test.ts` **legge la
 * migrazione** e pretende che i due elenchi coincidano: id, nome e colore. Se
 * qualcuno cambia l'uno senza l'altro, il test lo dice.
 */
export const CATEGORY_SEED: readonly Category[] = [
  { id: '90b5d419-ec03-4bd0-881f-e4904abc97e1', name: 'Alimentari', color: '#3f8f4f' },
  { id: 'd23098aa-aa3e-475c-a5cf-a0473869160c', name: 'Casa', color: '#2f6feb' },
  { id: '589cdd0e-a7e0-43ea-8cad-2448b666863e', name: 'Shopping', color: '#b455c9' },
  { id: '6bdf14a5-0b91-4f18-a123-4676506ae253', name: 'Carburante', color: '#d97706' },
  { id: 'b3eaf1b8-6d6d-4f50-bd08-3b4e0c7d0f01', name: 'Parcheggio', color: '#b45309' },
  { id: '5bacfd10-9c52-4000-8fe7-f446e4b4e475', name: 'Trasporti', color: '#4b6bbf' },
  { id: 'c52caa76-f6b0-42fd-b2ff-6b8d8a53f6a8', name: 'Ristoranti', color: '#ef4444' },
  { id: 'e8df2a0a-5d39-4a98-8db4-5e5d2f14d4c3', name: 'Bar e caffè', color: '#92400e' },
  { id: '0b76627d-74ec-4b95-8394-6e1c06b5bacf', name: 'Salute', color: '#d9455f' },
  { id: '5e7d6f5f-d5d4-4a28-98ef-f1d8b39dfb9e', name: 'Farmacia', color: '#dc2626' },
  { id: '7b4b4d7e-4c1d-42d7-8b73-fbb89e4a2b79', name: 'Istruzione', color: '#2563eb' },
  { id: 'a24c5b2e-18d6-4c7f-a8b7-2e2cb8b53d87', name: 'Lavoro', color: '#475569' },
  { id: '4f64d6c4-64dd-48d2-b5dd-4cba9c8b3f65', name: 'Bollette', color: '#f59e0b' },
  { id: 'b72f8b59-2dc2-4d88-a8a2-2d71b7b8db0c', name: 'Abbonamenti', color: '#7c3aed' },
  { id: 'd98f5f9d-4f4b-49c7-a3b0-f74d0c7cb99f', name: 'Intrattenimento', color: '#06b6d4' },
  { id: 'f8f3db8f-c11a-41cf-9a7b-91e79dc4ce75', name: 'Tempo libero', color: '#0e9aa7' },
  { id: 'e3e7df42-80d2-42c8-aec6-65f54f5c0c45', name: 'Viaggi', color: '#0f766e' },
  { id: 'f1f4b45d-f1b8-43e5-8d4b-5c1d7a7c6b74', name: 'Sport', color: '#16a34a' },
  { id: '7fd6d8a9-5f1c-4b2e-bb53-fd5f2b3f92f8', name: 'Animali', color: '#84cc16' },
  { id: '0b8e7b4f-4633-4562-bb27-9722eff8992d', name: 'Tabacco', color: '#8a6d3b' },
  { id: '6deb4a09-6ea5-455f-bfc2-f7ea9055a501', name: 'Altro', color: '#6b7280' },
  { id: 'd1f3e8c2-4b6a-4c9e-9f5b-3e2d7c8a1f2e', name: 'Regali', color: '#f97316' },
  { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'Rimborso', color: '#1e40af' },
  { id: 'c9bfcd74-e342-4a3f-8b0c-116f89236d51', name: 'Da classificare', color: '#9aa3af' },
];

/** Il file di migrazione che contiene lo stesso elenco. */
export const CATEGORY_SEED_MIGRATION = '0003_seed_categories.sql';
