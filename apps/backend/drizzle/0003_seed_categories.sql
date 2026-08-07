-- Categorie iniziali.
--
-- Gli identificativi sono fissi, così sono stabili su ogni installazione.
-- La migrazione viene applicata una sola volta; `OR IGNORE` con il vincolo di
-- unicità sul nome rende comunque il seed ripetibile senza duplicati.
INSERT OR IGNORE INTO `categories` (`id`, `name`, `color`) VALUES
('90b5d419-ec03-4bd0-881f-e4904abc97e1', 'Alimentari', '#3f8f4f'),
('d23098aa-aa3e-475c-a5cf-a0473869160c', 'Casa', '#2f6feb'),
('589cdd0e-a7e0-43ea-8cad-2448b666863e', 'Shopping', '#b455c9'),
('6bdf14a5-0b91-4f18-a123-4676506ae253', 'Carburante', '#d97706'),
('b3eaf1b8-6d6d-4f50-bd08-3b4e0c7d0f01', 'Parcheggio', '#b45309'),
('5bacfd10-9c52-4000-8fe7-f446e4b4e475', 'Trasporti', '#4b6bbf'),
('c52caa76-f6b0-42fd-b2ff-6b8d8a53f6a8', 'Ristoranti', '#ef4444'),
('e8df2a0a-5d39-4a98-8db4-5e5d2f14d4c3', 'Bar e caffè', '#92400e'),
('0b76627d-74ec-4b95-8394-6e1c06b5bacf', 'Salute', '#d9455f'),
('5e7d6f5f-d5d4-4a28-98ef-f1d8b39dfb9e', 'Farmacia', '#dc2626'),
('7b4b4d7e-4c1d-42d7-8b73-fbb89e4a2b79', 'Istruzione', '#2563eb'),
('a24c5b2e-18d6-4c7f-a8b7-2e2cb8b53d87', 'Lavoro', '#475569'),
('4f64d6c4-64dd-48d2-b5dd-4cba9c8b3f65', 'Bollette', '#f59e0b'),
('b72f8b59-2dc2-4d88-a8a2-2d71b7b8db0c', 'Abbonamenti', '#7c3aed'),
('d98f5f9d-4f4b-49c7-a3b0-f74d0c7cb99f', 'Intrattenimento', '#06b6d4'),
('f8f3db8f-c11a-41cf-9a7b-91e79dc4ce75', 'Tempo libero', '#0e9aa7'),
('e3e7df42-80d2-42c8-aec6-65f54f5c0c45', 'Viaggi', '#0f766e'),
('f1f4b45d-f1b8-43e5-8d4b-5c1d7a7c6b74', 'Sport', '#16a34a'),
('7fd6d8a9-5f1c-4b2e-bb53-fd5f2b3f92f8', 'Animali', '#84cc16'),
('0b8e7b4f-4633-4562-bb27-9722eff8992d', 'Tabacco', '#8a6d3b'),
('6deb4a09-6ea5-455f-bfc2-f7ea9055a501', 'Altro', '#6b7280'),
('c9bfcd74-e342-4a3f-8b0c-116f89236d51', 'Da classificare', '#9aa3af');
