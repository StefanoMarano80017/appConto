import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { toErrorMessage } from '../../core/http-error';
import { SettingsApi } from './settings.api';
import {
  SettingsFormErrors,
  SettingsFormValue,
  validateSettingsForm
} from './settings-form';

@Component({
  selector: 'app-settings-page',
  imports: [FormsModule, RouterLink],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss'
})
export class SettingsPage implements OnInit {
  private readonly api = inject(SettingsApi);

  protected readonly form = signal<SettingsFormValue>({ balanceDate: '', initialBalance: '' });
  protected readonly errors = signal<SettingsFormErrors>({});
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.loading.set(true);

    this.api.get().subscribe({
      next: (settings) => {
        this.form.set({
          balanceDate: settings.balanceDate ?? '',
          initialBalance: String(settings.initialBalance)
        });
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(toErrorMessage(error));
        this.loading.set(false);
      }
    });
  }

  protected update(field: keyof SettingsFormValue, value: string): void {
    this.form.update((form) => ({ ...form, [field]: value }));
    this.saved.set(false);
  }

  protected save(): void {
    const result = validateSettingsForm(this.form());
    if (!result.valid) {
      this.errors.set(result.errors);
      return;
    }

    this.errors.set({});
    this.saving.set(true);
    this.error.set(null);

    this.api.update(result.settings).subscribe({
      next: (settings) => {
        this.form.set({
          balanceDate: settings.balanceDate ?? '',
          initialBalance: String(settings.initialBalance)
        });
        this.saving.set(false);
        this.saved.set(true);
      },
      error: (error: unknown) => {
        this.error.set(toErrorMessage(error));
        this.saving.set(false);
      }
    });
  }
}
