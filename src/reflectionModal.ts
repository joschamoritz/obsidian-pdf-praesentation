// „Nach der Stunde“: drei kurze Felder beim Beenden, direkt in die Reflexion des Stundenentwurfs.

import { Modal, type App } from 'obsidian';
import type { ReflectionEntries } from './presenter/lessonData';

const OFF_KEY = 'pdf-praesentation-reflexion-aus';

export function reflectionWanted(): boolean {
  try {
    return window.localStorage.getItem(OFF_KEY) !== '1';
  } catch {
    return true;
  }
}

function switchOff(): void {
  try {
    window.localStorage.setItem(OFF_KEY, '1');
  } catch {
    // Ohne Speicher fragt das Plugin beim nächsten Mal wieder.
  }
}

const FIELDS: [keyof ReflectionEntries, string][] = [
  ['good', 'Was hat gut funktioniert?'],
  ['change', 'Was würde ich beim nächsten Mal ändern?'],
  ['observe', 'Besondere Beobachtungen zur Lerngruppe'],
];

export class ReflectionModal extends Modal {
  constructor(
    app: App,
    private noteName: string,
    private dwell: string,
    private onSave: (entries: ReflectionEntries, withDwell: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.setTitle('Nach der Stunde');
    contentEl.addClass('pp-reflection');
    contentEl.createEl('p', { cls: 'pp-reflection-note', text: `Kommt in „${this.noteName}“ unter „Reflexion & Notizen“. Leere Felder bleiben leer.` });
    const values: Partial<Record<keyof ReflectionEntries, HTMLTextAreaElement>> = {};
    for (const [key, label] of FIELDS) {
      const field = contentEl.createEl('label', { cls: 'pp-reflection-field' });
      field.createEl('span', { text: label });
      const area = field.createEl('textarea');
      area.rows = 3;
      values[key] = area;
    }
    let withDwell = !!this.dwell;
    if (this.dwell) {
      const row = contentEl.createEl('label', { cls: 'pp-reflection-dwell' });
      const box = row.createEl('input', { type: 'checkbox' });
      box.checked = true;
      box.addEventListener('change', () => (withDwell = box.checked));
      row.createEl('span', { text: this.dwell });
    }
    const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
    const off = buttons.createEl('button', { text: 'Nicht mehr fragen' });
    off.addEventListener('click', () => {
      switchOff();
      this.close();
    });
    buttons.createEl('button', { text: 'Später' }).addEventListener('click', () => this.close());
    const save = buttons.createEl('button', { text: 'In den Entwurf schreiben', cls: 'mod-cta' });
    save.addEventListener('click', () => {
      const entries = {
        good: values.good?.value ?? '',
        change: values.change?.value ?? '',
        observe: values.observe?.value ?? '',
      };
      this.onSave(entries, withDwell);
      this.close();
    });
    window.setTimeout(() => values.good?.focus(), 50);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
