import { Routes } from '@angular/router';
import { ImportPage } from './features/import/import-page';
import { MerchantsPage } from './features/merchants/merchants-page';
import { SettingsPage } from './features/settings/settings-page';
import { SummaryPage } from './features/summary/summary-page';

export const routes: Routes = [
  { path: '', component: SummaryPage, title: 'Riepilogo' },
  { path: 'merchants', component: MerchantsPage, title: 'Merchant' },
  { path: 'import', component: ImportPage, title: 'Import CSV' },
  { path: 'settings', component: SettingsPage, title: 'Impostazioni' },
  // la tabella delle transazioni vive sotto il riepilogo
  { path: 'transactions', redirectTo: '', pathMatch: 'full' },
  { path: '**', redirectTo: '' }
];
