-- "Da classificare" ha una sola rappresentazione: `category_id` nullo.
--
-- Prima di questa versione l'eliminazione di una categoria spostava i suoi
-- merchant sulla riga reale di "Da classificare" (id fisso del seed 0003),
-- mentre filtri e conteggi riconoscono come non classificati soltanto i
-- merchant con `category_id` nullo. Qui quei merchant tornano a null.
--
-- La riga della categoria resta: è l'etichetta mostrata per i merchant senza
-- categoria. L'istruzione è idempotente: rieseguita, non trova più righe.
UPDATE `merchants` SET `category_id` = NULL WHERE `category_id` = 'c9bfcd74-e342-4a3f-8b0c-116f89236d51';
