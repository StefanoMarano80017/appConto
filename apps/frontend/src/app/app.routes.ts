import { Routes } from '@angular/router';
import { AnalyticsPage } from './features/analytics/analytics-page';
import { DashboardPage } from './features/dashboard/dashboard-page';
import { ImportPage } from './features/import/import-page';
import { LoanCreatePage } from './features/loans/loan-create-page';
import { LoanDetailPage } from './features/loans/loan-detail-page';
import { LoansPage } from './features/loans/loans-page';
import { MerchantsPage } from './features/merchants/merchants-page';
import { SettingsPage } from './features/settings/settings-page';
import { TransactionsPage } from './features/transactions/transactions-page';

export const routes: Routes = [
  { 
    path: '', 
    component: DashboardPage, 
    title: 'Riepilogo' 
  },
  { 
    path: 'analytics', 
    component: AnalyticsPage, 
    title: 'Analytics' 
  },
  { 
    path: 'transactions', 
    component: TransactionsPage, 
    title: 'Movimenti' 
  },
  {
    path: 'loans',
    component: LoansPage,
    title: 'Prestiti'
  },
  {
    // Registrata prima della rotta con parametro: 'new' non è l'id di un prestito.
    path: 'loans/new',
    component: LoanCreatePage,
    title: 'Crea prestito'
  },
  {
    path: 'loans/:id',
    component: LoanDetailPage,
    title: 'Prestito'
  },
  { 
    path: 'merchants', 
    component: MerchantsPage, 
    title: 'Merchant' 
  },
  { 
    path: 'import', 
    component: ImportPage, 
    title: 'Import CSV' 
  },
  { 
    path: 'settings', 
    component: SettingsPage, 
    title: 'Impostazioni' 
  },
  { path: '**', redirectTo: '' }
];
