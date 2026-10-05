// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { PromptLabel } from './PromptLabel.js';
import { setInteractKey } from './promptKeys.js';

describe('PromptLabel', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('creates a #prompt element when the page has none', () => {
    const prompt = new PromptLabel();
    expect(document.getElementById('prompt')).toBe(prompt.root);
  });

  it('reuses an existing #prompt element', () => {
    const el = document.createElement('div');
    el.id = 'prompt';
    document.body.appendChild(el);
    expect(new PromptLabel().root).toBe(el);
    expect(document.querySelectorAll('#prompt').length).toBe(1);
  });

  it('starts hidden', () => {
    const prompt = new PromptLabel();
    expect(prompt.visible).toBe(false);
  });

  it('show sets the text and reveals it; hide hides it', () => {
    const prompt = new PromptLabel();
    prompt.show('Locked');
    expect(prompt.text).toBe('Locked');
    expect(prompt.visible).toBe(true);
    prompt.hide();
    expect(prompt.visible).toBe(false);
  });

  it('is a no-op without an element', () => {
    const prompt = new PromptLabel(null);
    expect(() => { prompt.show('x'); prompt.hide(); }).not.toThrow();
    expect(prompt.visible).toBe(false);
  });

  it('names the bound interact key through an injected keyLabel', () => {
    const prompt = new PromptLabel(undefined, { keyLabel: (t) => t.replace('[E]', '[F]') });
    prompt.show('[E] Use Computer');
    expect(prompt.text).toBe('[F] Use Computer');
  });

  it('defaults to the shared interact key', () => {
    setInteractKey('G');
    const prompt = new PromptLabel();
    prompt.show('[E] Sleep');
    expect(prompt.text).toBe('[G] Sleep');
    setInteractKey('E');
  });
});
