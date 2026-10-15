// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { JournalPanel } from './JournalPanel.js';

const ENTRY = { night: 2, title: 'Night two', body: ['First paragraph.', 'Second <b>paragraph</b>.'] };

describe('JournalPanel', () => {
  let root, panel;
  beforeEach(() => {
    document.body.innerHTML = '<div id="journal"></div>';
    root = document.getElementById('journal');
    panel = new JournalPanel();
  });

  it('starts hidden', () => {
    expect(panel.visible).toBe(false);
  });

  it('shows the entry as paper: the title and one paragraph each', () => {
    panel.show(ENTRY);
    expect(panel.visible).toBe(true);
    expect(root.querySelector('.journal-title').textContent).toBe('Night two');
    expect([...root.querySelectorAll('.journal-body p')].map(p => p.textContent))
      .toEqual(['First paragraph.', 'Second <b>paragraph</b>.']);
    expect(root.querySelector('b')).toBeNull();          // text, never HTML
  });

  it('says how to put it down', () => {
    panel.show(ENTRY);
    expect(root.querySelector('.journal-hint').textContent).toMatch(/\[E\]/);
  });

  it('hide() hides it', () => {
    panel.show(ENTRY);
    panel.hide();
    expect(panel.visible).toBe(false);
  });

  it('is a no-op without markup', () => {
    const headless = new JournalPanel(null);
    expect(() => { headless.show(ENTRY); headless.hide(); }).not.toThrow();
    expect(headless.visible).toBe(false);
  });
});
